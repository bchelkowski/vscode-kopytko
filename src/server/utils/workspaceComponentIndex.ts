import * as path from 'path';
import { parseComponentTag, findParentXmls } from '../brightscript/xmlScriptParser';
import { readCachedFileText, invalidateFileParseCache } from './fileParseCache';
import fsWrapper from './fsWrapper';

/** A SceneGraph component declared by a workspace `.xml` file. */
export interface ComponentEntry {
  name: string;
  nameLower: string;
  extendsName?: string;
  extendsLower?: string;
  /** Absolute path of the XML that declares this component. */
  filePath: string;
  /** Zero-based position of the `name` attribute value. */
  nameLine: number;
  nameColumn: number;
  /** Zero-based position of the `extends` attribute value, when present. */
  extendsLine?: number;
  extendsColumn?: number;
}

/**
 * Workspace-wide index of SceneGraph components declared in `.xml` files:
 * name → declaration, and parent name → direct subtypes.
 *
 * `findComponentXml` (xmlScriptParser) already resolves a *single* name to a
 * file by walking directories, but it cannot answer the reverse question
 * ("which components extend X?") without scanning the workspace per request.
 * This index is built once at startup and updated incrementally by the file
 * watcher, so both directions are map lookups.
 *
 * Staleness model: trust-the-watcher, identical to `WorkspaceCallIndex`.
 */
export class WorkspaceComponentIndex {
  /** Absolute XML path → the component it declares. */
  private _byFile = new Map<string, ComponentEntry>();
  /**
   * Lowercased component name → every declaration of it. Normally one entry;
   * more than one means the project declares the same component twice, which
   * `ComponentDiagnosticsService` reports off `getAll()`.
   */
  private _byName = new Map<string, ComponentEntry[]>();
  /** Lowercased parent name → direct subtypes. Rebuilt lazily after any change. */
  private _children: Map<string, ComponentEntry[]> | null = null;
  /** The de-duplicated roots of the last `build()`, so updates stay in scope. */
  private _roots: string[] = [];
  private _built = false;

  build(roots: string[]): void {
    this._byFile.clear();
    this._byName.clear();
    this._children = null;
    this._roots = dedupeRoots(roots);
    this._built = true;
    for (const root of this._roots) {
      this._walkDir(root);
    }
    this._rebuildNameMap();
  }

  updateFile(filePath: string): void {
    if (!filePath.endsWith('.xml')) return;
    if (!this._isInScope(filePath)) return;

    invalidateFileParseCache(filePath);
    this._byFile.delete(filePath);
    const entry = this._parseFile(filePath);
    if (entry) this._byFile.set(filePath, entry);
    this._rebuildNameMap();
  }

  removeFile(filePath: string): void {
    if (!filePath.endsWith('.xml')) return;

    invalidateFileParseCache(filePath);
    this._byFile.delete(filePath);
    this._rebuildNameMap();
  }

  /** The winning declaration for a name — the first by file path when duplicated. */
  getComponent(nameLower: string): ComponentEntry | undefined {
    return this._byName.get(nameLower)?.[0];
  }

  /** Components whose `extends` names `parentNameLower`, sorted by name. */
  getChildren(parentNameLower: string): ComponentEntry[] {
    if (!this._children) {
      const map = new Map<string, ComponentEntry[]>();
      for (const entry of this._allEntries()) {
        if (!entry.extendsLower) continue;
        const group = map.get(entry.extendsLower);
        if (group) {
          group.push(entry);
        } else {
          map.set(entry.extendsLower, [entry]);
        }
      }
      for (const group of map.values()) {
        group.sort((a, b) => a.name.localeCompare(b.name));
      }
      this._children = map;
    }
    return this._children.get(parentNameLower) ?? [];
  }

  /** Every indexed declaration, sorted by name. */
  getAll(): ComponentEntry[] {
    return this._allEntries().sort((a, b) => a.name.localeCompare(b.name));
  }

  private _allEntries(): ComponentEntry[] {
    return [...this._byName.values()].flat();
  }

  /**
   * Whether `build()` would have walked to this file.
   *
   * The client watches `**​/*.xml` across the whole workspace, so `updateFile`
   * sees paths the build deliberately skipped — anything under `node_modules`
   * that is not a Kopytko package base dir, and anything in a dot-directory.
   * Indexing those on a write would make the index depend on which files
   * happened to change since startup: a duplicate-name warning that a restart
   * makes disappear. Deletions are never gated — dropping an entry is safe.
   */
  private _isInScope(filePath: string): boolean {
    if (!this._built) return true;
    const normalized = path.normalize(filePath);
    return this._roots.some((root) => walkReaches(root, normalized));
  }

  /**
   * Components declared by the XML files that pull in `brsPath` via a `<script>`
   * tag. Usually one, but a `.brs` shared by several components yields several.
   */
  getComponentForBrsFile(brsPath: string): ComponentEntry[] {
    const entries: ComponentEntry[] = [];
    for (const xmlPath of findParentXmls(brsPath)) {
      const entry = this._byFile.get(xmlPath) ?? this._parseFile(xmlPath);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /**
   * Rebuilt from `_byFile` on every change so a renamed or deleted component
   * never lingers under its old name. Iterating in path order makes the winning
   * declaration — and the order duplicates are reported in — deterministic.
   */
  private _rebuildNameMap(): void {
    this._byName.clear();
    this._children = null;
    for (const filePath of [...this._byFile.keys()].sort()) {
      const entry = this._byFile.get(filePath);
      if (!entry) continue;
      const declarations = this._byName.get(entry.nameLower);
      if (declarations) {
        declarations.push(entry);
      } else {
        this._byName.set(entry.nameLower, [entry]);
      }
    }
  }

  private _parseFile(filePath: string): ComponentEntry | undefined {
    const text = readCachedFileText(filePath);
    if (!text) return undefined;

    const tag = parseComponentTag(text);
    if (!tag) return undefined;

    return {
      name: tag.name,
      nameLower: tag.name.toLowerCase(),
      extendsName: tag.extendsName,
      extendsLower: tag.extendsName?.toLowerCase(),
      filePath,
      nameLine: tag.nameLine,
      nameColumn: tag.nameColumn,
      extendsLine: tag.extendsLine,
      extendsColumn: tag.extendsColumn,
    };
  }

  private _walkDir(dir: string): void {
    let entries: ReturnType<typeof fsWrapper.readdirTyped>;
    try {
      entries = fsWrapper.readdirTyped(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory) {
        this._walkDir(full);
      } else if (entry.name.endsWith('.xml')) {
        const component = this._parseFile(full);
        if (component) this._byFile.set(full, component);
      }
    }
  }
}

/**
 * Collapses roots that another root's walk would already cover.
 *
 * `buildSearchRoots()` returns overlapping roots by design — both `<ws>` and
 * `<ws>/<sourceDir>` — and walking a subtree twice costs a full `readdirTyped`
 * pass per duplicate (file *reads* dedupe via the file cache, directory
 * listings do not).
 *
 * "Covered" has to mean *reachable*, not merely "is a sub-path". Kopytko package
 * base dirs sit under `<ws>/node_modules/…`, which `_walkDir` refuses to descend
 * into — dropping them as nested would silently un-index every package component.
 */
function dedupeRoots(roots: string[]): string[] {
  const normalized = [...new Set(roots.filter(Boolean).map((r) => path.normalize(r)))]
    .sort((a, b) => a.length - b.length);

  const kept: string[] = [];
  for (const root of normalized) {
    if (!kept.some((k) => walkReaches(k, root))) kept.push(root);
  }
  return kept;
}

/** Whether a walk starting at `ancestor` would descend into `descendant`. */
function walkReaches(ancestor: string, descendant: string): boolean {
  if (descendant === ancestor) return true;

  const prefix = ancestor.endsWith(path.sep) ? ancestor : ancestor + path.sep;
  if (!descendant.startsWith(prefix)) return false;

  // Mirrors the skip rules in `_walkDir`
  return descendant
    .slice(prefix.length)
    .split(path.sep)
    .every((segment) => segment !== 'node_modules' && !segment.startsWith('.'));
}
