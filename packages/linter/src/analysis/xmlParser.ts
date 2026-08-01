import * as nodePath from 'path';
import fsWrapper from './fsWrapper';
import { parseXmlScriptUris, parseXmlExtends, parseXmlComponentName, parseXmlInterface, parseComponentTag } from 'kopytko-brightscript-parser';

// parseXmlScriptUris / parseXmlExtends / parseXmlComponentName / parseXmlInterface
// are the parser package's CST-based versions — same names and shapes as the
// regex functions they replaced here, so projectIndexer.ts and index.ts did
// not need to change. This also picks up the bug fixes already proven in the
// extension's own equivalent migration (findings/lsp-architecture.md): a
// single-quoted `uri='...'` now matches (the regex here only matched double
// quotes), and a commented-out `<field id="ghost"/>` is no longer reported as
// real (comments are CST trivia, invisible to a structural query, where the
// regex version had no comment awareness at all).
export { parseXmlScriptUris, parseXmlExtends, parseXmlComponentName, parseXmlInterface };
export type { ParsedXmlInterface, XmlInterfaceField, XmlInterfaceFunction } from 'kopytko-brightscript-parser';

/**
 * Resolves a script URI from an XML file to an absolute filesystem path.
 * Supports `pkg:/path/file.brs` and relative paths.
 *
 * Filesystem-dependent, so — same as `kopytko-roku-device` staying Kopytko-
 * ecosystem-unaware — this stays local rather than moving into the parser
 * package, which owns per-file structural facts only, never disk I/O.
 */
export function resolveScriptUri(
  uri: string,
  xmlDir: string,
  workspaceFolders: string[],
  sourceDir: string,
  cachedExists?: (path: string) => boolean,
): string | undefined {
  const exists = cachedExists ?? fsWrapper.existsSync;

  if (uri.startsWith('pkg:/')) {
    const rel = uri.slice(5);
    for (const ws of workspaceFolders) {
      const candidate = nodePath.join(ws, sourceDir, rel);
      if (exists(candidate)) return candidate;
      const candidateRoot = nodePath.join(ws, rel);
      if (exists(candidateRoot)) return candidateRoot;
    }
    return undefined;
  }
  const candidate = nodePath.join(xmlDir, uri);
  return exists(candidate) ? candidate : undefined;
}

/**
 * Returns absolute paths for all BrightScript files listed in an XML's <script> tags.
 */
export function getScriptPathsFromXml(
  xmlPath: string,
  xmlText: string,
  workspaceFolders: string[],
  sourceDir: string,
  cachedExists?: (path: string) => boolean,
): string[] {
  const xmlDir = nodePath.dirname(xmlPath);
  return parseXmlScriptUris(xmlText)
    .map((uri) => resolveScriptUri(uri, xmlDir, workspaceFolders, sourceDir, cachedExists))
    .filter((p): p is string => p !== undefined);
}

/** A `<component>` tag's declared name, with the source position of the value. */
export interface ComponentNamePosition {
  name: string;
  /** Zero-based position of the first character of the `name` attribute value. */
  line: number;
  column: number;
}

/**
 * Like `parseXmlComponentName`, but also reports where the value is written.
 *
 * Needed by any diagnostic that has to point at the declaration itself rather
 * than at the file as a whole. Thin adapter over the parser's
 * `parseComponentTag`, which is already scoped to the `<component>` tag's own
 * attribute list (so a `<function name="…">` inside `<interface>` is never
 * picked up by mistake) and reports `nameLine`/`nameColumn` with the exact
 * same "first character of the attribute value" semantics this used to
 * compute by hand.
 */
export function parseComponentNamePosition(xmlText: string): ComponentNamePosition | null {
  const tag = parseComponentTag(xmlText);
  if (!tag) return null;
  return { name: tag.name, line: tag.nameLine, column: tag.nameColumn };
}

/**
 * Searches directories recursively for a file by name.
 */
function findFileInTree(dir: string, filename: string, depth: number): string | undefined {
  if (depth < 0) return undefined;
  let entries: ReturnType<typeof fsWrapper.readdirTyped>;
  try {
    entries = fsWrapper.readdirTyped(dir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory && entry.name === filename) {
      return nodePath.join(dir, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const found = findFileInTree(nodePath.join(dir, entry.name), filename, depth - 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Searches directories for an XML file whose <component name="..."> matches.
 */
function findXmlByComponentName(dir: string, nameLower: string, depth: number): string | undefined {
  if (depth < 0) return undefined;
  let entries: ReturnType<typeof fsWrapper.readdirTyped>;
  try {
    entries = fsWrapper.readdirTyped(dir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.name.endsWith('.xml')) continue;
    const xmlPath = nodePath.join(dir, entry.name);
    try {
      const text = fsWrapper.readFileSync(xmlPath, 'utf-8');
      const name = parseXmlComponentName(text);
      if (name && name.toLowerCase() === nameLower) {
        return xmlPath;
      }
    } catch { /* skip */ }
  }
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const found = findXmlByComponentName(nodePath.join(dir, entry.name), nameLower, depth - 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Finds a component's XML file by name across multiple search roots.
 * Tries exact filename match first, then searches by <component name="..."> attribute.
 */
export function findComponentXml(
  componentName: string,
  searchRoots: string[],
  maxDepth = 8,
): string | undefined {
  const filename = `${componentName}.xml`;
  for (const root of searchRoots) {
    const found = findFileInTree(root, filename, maxDepth);
    if (found) return found;
  }
  const nameLower = componentName.toLowerCase();
  for (const root of searchRoots) {
    const found = findXmlByComponentName(root, nameLower, maxDepth);
    if (found) return found;
  }
  return undefined;
}
