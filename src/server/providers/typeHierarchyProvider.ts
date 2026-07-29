import { Position, Range, SymbolKind, TypeHierarchyItem } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { getWordAtPosition } from 'kopytko-brightscript-parser';
import { findSgNodeInsensitive, getSgNodeChildren } from '../brightscript/sgNodes';
import { parseComponentTag } from '../brightscript/xmlScriptParser';
import { ComponentEntry, WorkspaceComponentIndex } from '../utils/workspaceComponentIndex';
import { readCachedFileText } from '../utils/fileParseCache';
import { getCachedLines } from '../utils/documentCache';

const BUILTIN_DETAIL = 'built-in SceneGraph node';

/** Round-tripped through the client on every hierarchy item (LSP preserves `data`). */
interface TypeHierarchyData {
  nameLower: string;
  builtin: boolean;
}

/** Where a hierarchy item points when it has no source file of its own. */
interface Anchor {
  uri: string;
  line: number;
  column: number;
  length: number;
}

/**
 * Type hierarchy over SceneGraph `extends` chains.
 *
 * Supertypes walk `<component extends="…">` upwards until the chain reaches the
 * built-in node catalog; subtypes come from the workspace component index plus
 * the built-in catalog's own descendants.
 *
 * Built-in nodes have no file of their own, so their items are *anchored* to the
 * place that referenced them — the `extends="Group"` attribute of the component
 * below, or the anchor of the item they were expanded from. A click therefore
 * always lands on real text instead of failing to open a synthetic URI.
 */
export class BrightScriptTypeHierarchyProvider {
  constructor(private readonly _index: WorkspaceComponentIndex) {}

  /**
   * `document` is the synced TextDocument when the request came from a `.brs`
   * file. XML is registered dynamically and is never synced (see `server.ts`),
   * so for `.xml` the text comes from the file cache instead.
   */
  prepare(uri: string, position: Position, document?: TextDocument): TypeHierarchyItem[] | null {
    const fsPath = URI.parse(uri).fsPath;
    const text = document?.getText() ?? readCachedFileText(fsPath);
    if (text === undefined) return null;

    // Splitting here is safe: type hierarchy is only ever invoked explicitly by
    // the user, never on the keystroke path the document cache exists to protect.
    const lines = document ? getCachedLines(document) : text.split(/\r?\n/);
    const lineText = lines[position.line] ?? '';
    const word = getWordAtPosition(lineText, position.character);
    const wordAnchor: Anchor | undefined = word
      ? { uri, line: position.line, column: word.start, length: word.end - word.start }
      : undefined;

    if (fsPath.toLowerCase().endsWith('.xml')) {
      const tag = parseComponentTag(text);

      if (tag?.extendsName && tag.extendsLine !== undefined && tag.extendsColumn !== undefined
        && isInSpan(position, tag.extendsLine, tag.extendsColumn, tag.extendsName.length)) {
        const anchor: Anchor = {
          uri, line: tag.extendsLine, column: tag.extendsColumn, length: tag.extendsName.length,
        };
        const item = this._itemForName(tag.extendsName, anchor);
        if (item) return [item];
      }

      // A word elsewhere in the file — a child element tag such as
      // `<MyButton id="ok" />`, or the component's own `name` attribute.
      if (word && wordAnchor) {
        const item = this._itemForName(word.word, wordAnchor);
        if (item) return [item];
      }

      // Anywhere else: the component this file declares. Also the safety net
      // when the cached text is stale and the position no longer lines up.
      if (tag) {
        const entry = this._index.getComponent(tag.name.toLowerCase())
          ?? entryFromFile(tag, fsPath);
        return [componentItem(entry)];
      }
      return null;
    }

    if (word && wordAnchor) {
      const item = this._itemForName(word.word, wordAnchor);
      if (item) return [item];
    }

    // A .brs file belongs to whichever component(s) pull it in via <script>.
    const owners = this._index.getComponentForBrsFile(fsPath);
    return owners.length > 0 ? owners.map(componentItem) : null;
  }

  /** The direct parent only — VS Code expands the chain one level at a time. */
  supertypes(item: TypeHierarchyItem): TypeHierarchyItem[] {
    if (isBuiltin(item)) {
      const parent = findSgNodeInsensitive(item.name)?.extends;
      if (!parent) return [];
      const parentItem = this._itemForName(parent, anchorOf(item));
      return parentItem ? [parentItem] : [];
    }

    const entry = this._entryFor(item);
    if (!entry?.extendsName || !entry.extendsLower) return [];
    if (entry.extendsLower === entry.nameLower) return []; // self-referential extends

    const anchor: Anchor = {
      uri: URI.file(entry.filePath).toString(),
      line: entry.extendsLine ?? entry.nameLine,
      column: entry.extendsColumn ?? entry.nameColumn,
      length: entry.extendsName.length,
    };
    const parentItem = this._itemForName(entry.extendsName, anchor);
    return parentItem ? [parentItem] : [];
  }

  /** Workspace components first, then built-in descendants. */
  subtypes(item: TypeHierarchyItem): TypeHierarchyItem[] {
    const nameLower = nameLowerOf(item);
    const items = this._index.getChildren(nameLower).map(componentItem);

    const anchor = anchorOf(item);
    for (const child of getSgNodeChildren(nameLower)) {
      items.push(builtinItem(child.name, anchor));
    }
    return items;
  }

  /** Resolves a component name to an item — workspace declarations win. */
  private _itemForName(name: string, anchor: Anchor): TypeHierarchyItem | undefined {
    const entry = this._index.getComponent(name.toLowerCase());
    if (entry) return componentItem(entry);

    const builtin = findSgNodeInsensitive(name);
    return builtin ? builtinItem(builtin.name, anchor) : undefined;
  }

  /**
   * The indexed declaration behind a component item. Falls back to re-parsing
   * the item's own XML so components outside the indexed roots still resolve.
   */
  private _entryFor(item: TypeHierarchyItem): ComponentEntry | undefined {
    const indexed = this._index.getComponent(nameLowerOf(item));
    if (indexed) return indexed;

    const fsPath = URI.parse(item.uri).fsPath;
    if (!fsPath.toLowerCase().endsWith('.xml')) return undefined;
    const text = readCachedFileText(fsPath);
    if (!text) return undefined;
    const tag = parseComponentTag(text);
    return tag ? entryFromFile(tag, fsPath) : undefined;
  }
}

function componentItem(entry: ComponentEntry): TypeHierarchyItem {
  const end = entry.nameColumn + entry.name.length;
  return {
    name: entry.name,
    kind: SymbolKind.Class,
    detail: entry.extendsName ? `extends ${entry.extendsName}` : undefined,
    uri: URI.file(entry.filePath).toString(),
    range: Range.create(entry.nameLine, 0, entry.nameLine, end),
    selectionRange: Range.create(entry.nameLine, entry.nameColumn, entry.nameLine, end),
    data: { nameLower: entry.nameLower, builtin: false } satisfies TypeHierarchyData,
  };
}

function builtinItem(name: string, anchor: Anchor): TypeHierarchyItem {
  const end = anchor.column + anchor.length;
  return {
    name,
    kind: SymbolKind.Interface,
    detail: BUILTIN_DETAIL,
    uri: anchor.uri,
    range: Range.create(anchor.line, 0, anchor.line, end),
    selectionRange: Range.create(anchor.line, anchor.column, anchor.line, end),
    data: { nameLower: name.toLowerCase(), builtin: true } satisfies TypeHierarchyData,
  };
}

/** A component declaration synthesised from a file that the index does not hold. */
function entryFromFile(tag: NonNullable<ReturnType<typeof parseComponentTag>>, filePath: string): ComponentEntry {
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

function isInSpan(position: Position, line: number, column: number, length: number): boolean {
  return position.line === line
    && position.character >= column
    && position.character <= column + length;
}

function isBuiltin(item: TypeHierarchyItem): boolean {
  return (item.data as TypeHierarchyData | undefined)?.builtin === true;
}

function nameLowerOf(item: TypeHierarchyItem): string {
  return (item.data as TypeHierarchyData | undefined)?.nameLower ?? item.name.toLowerCase();
}

function anchorOf(item: TypeHierarchyItem): Anchor {
  const { start, end } = item.selectionRange;
  return {
    uri: item.uri,
    line: start.line,
    column: start.character,
    length: Math.max(0, end.character - start.character),
  };
}
