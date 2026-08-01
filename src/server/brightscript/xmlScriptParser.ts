import * as path from 'path';
import fsWrapper from '../utils/fsWrapper';
import {
  parseXmlScriptUris, parseXmlInterface, parseXmlExtends, parseXmlComponentName, parseComponentTag,
} from 'kopytko-brightscript-parser';
import type { ComponentTagInfo } from 'kopytko-brightscript-parser';

// Re-exported for existing callers — these are now CST-backed (see
// packages/brightscript-parser/src/xml/sceneGraphQueries.ts), not regex.
// Kept here rather than importing 'kopytko-brightscript-parser' directly at
// every call site because this file is the established "SceneGraph XML"
// entry point for the server; the file-system-dependent functions below
// (resolving URIs, finding files) are what stays genuinely local to the
// extension, per this module's original design.
export { parseXmlScriptUris, parseXmlInterface, parseXmlExtends, parseComponentTag };
export type { ComponentTagInfo };

/**
 * Resolves a script URI from an XML file to an absolute filesystem path.
 *
 * Supports:
 *   - pkg:/path/to/file.brs  → {workspace}/{sourceDir}/path/to/file.brs
 *   - relative/path.brs      → relative to xmlDir
 */
export function resolveScriptUri(
  uri: string,
  xmlDir: string,
  workspaceFolders: string[],
  sourceDir: string,
): string | undefined {
  if (uri.startsWith('pkg:/')) {
    const rel = uri.slice(5);
    for (const ws of workspaceFolders) {
      const candidate = path.join(ws, sourceDir, rel);
      if (fsWrapper.existsSync(candidate)) return candidate;
      const candidateRoot = path.join(ws, rel);
      if (fsWrapper.existsSync(candidateRoot)) return candidateRoot;
    }
    return undefined;
  }
  // Relative URI — resolve against the XML file's directory
  const candidate = path.join(xmlDir, uri);
  return fsWrapper.existsSync(candidate) ? candidate : undefined;
}

/**
 * Returns absolute paths for all BrightScript files listed in the given XML's
 * <script> tags.
 */
export function getScriptPathsFromXml(
  xmlPath: string,
  workspaceFolders: string[],
  sourceDir: string,
): string[] {
  let xmlText: string;
  try {
    xmlText = fsWrapper.readFileSync(xmlPath, 'utf-8');
  } catch {
    return [];
  }
  const xmlDir = path.dirname(xmlPath);
  return parseXmlScriptUris(xmlText)
    .map((uri) => resolveScriptUri(uri, xmlDir, workspaceFolders, sourceDir))
    .filter((p): p is string => p !== undefined);
}

/**
 * Finds all XML files in the same directory as the given .brs file that
 * reference it via a <script> tag.
 */
export function findParentXmls(brsPath: string): string[] {
  const dir = path.dirname(brsPath);
  const brsBasename = path.basename(brsPath);
  let entries: string[] | undefined;
  try {
    entries = fsWrapper.readdirSync(dir);
  } catch {
    return [];
  }
  if (!entries) return [];
  const xmlFiles = entries.filter((f) => f.endsWith('.xml'));
  const results: string[] = [];
  for (const xmlFile of xmlFiles) {
    const xmlPath = path.join(dir, xmlFile);
    try {
      const content = fsWrapper.readFileSync(xmlPath, 'utf-8');
      // Quick substring check before full parse
      if (content.includes(brsBasename)) {
        results.push(xmlPath);
      }
    } catch {
      // skip unreadable XML
    }
  }
  return results;
}

/**
 * Returns absolute paths of all BrightScript sibling files that share an XML
 * component definition with the given .brs file (excludes the file itself).
 */
export function getXmlSiblingPaths(
  brsPath: string,
  workspaceFolders: string[],
  sourceDir: string,
): string[] {
  const parentXmls = findParentXmls(brsPath);
  const normalizedSelf = path.normalize(brsPath).toLowerCase();
  const siblings = new Set<string>();
  for (const xmlPath of parentXmls) {
    for (const scriptPath of getScriptPathsFromXml(xmlPath, workspaceFolders, sourceDir)) {
      if (path.normalize(scriptPath).toLowerCase() !== normalizedSelf) {
        siblings.add(scriptPath);
      }
    }
  }
  return [...siblings];
}

/**
 * Memoizes component-name → XML-path resolution, including negative results.
 * `findComponentXml` does full recursive directory walks (reading and
 * parsing every XML), and is called for each link in an `extends` chain
 * during type inference / completion. The key includes `searchRoots` (which vary
 * by workspace/package context) so results never bleed across contexts. Cleared
 * by `invalidateAllCaches()` on any watched-file or config change.
 */
const _componentXmlCache = new Map<string, string | undefined>();

/** Clears the component-name → XML-path resolution cache. */
export function clearComponentXmlCache(): void {
  _componentXmlCache.clear();
}

/**
 * Searches `searchRoots` recursively (up to `maxDepth` levels) for a file named
 * `<componentName>.xml` and returns its absolute path, or undefined if not found.
 */
export function findComponentXml(
  componentName: string,
  searchRoots: string[],
  maxDepth = 8,
): string | undefined {
  const cacheKey = `${componentName.toLowerCase()} ${maxDepth} ${searchRoots.join(' ')}`;
  const cached = _componentXmlCache.get(cacheKey);
  if (cached !== undefined || _componentXmlCache.has(cacheKey)) return cached;

  const result = _findComponentXml(componentName, searchRoots, maxDepth);
  _componentXmlCache.set(cacheKey, result);
  return result;
}

function _findComponentXml(
  componentName: string,
  searchRoots: string[],
  maxDepth: number,
): string | undefined {
  // Try exact filename match first (fastest)
  const filename = `${componentName}.xml`;
  for (const root of searchRoots) {
    const found = findFileInTree(root, filename, maxDepth);
    if (found) return found;
  }
  // Fall back: search XML files by their <component name="..."> attribute
  // This handles cases like `extends="RokuStoreRequest"` → file `RokuStore.request.xml`
  const nameLower = componentName.toLowerCase();
  for (const root of searchRoots) {
    const found = findXmlByComponentName(root, nameLower, maxDepth);
    if (found) return found;
  }
  return undefined;
}

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
    const xmlPath = path.join(dir, entry.name);
    try {
      const text = fsWrapper.readFileSync(xmlPath, 'utf-8');
      const name = parseXmlComponentName(text);
      if (name && name.toLowerCase() === nameLower) {
        return xmlPath;
      }
    } catch { /* skip unreadable */ }
  }
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const found = findXmlByComponentName(path.join(dir, entry.name), nameLower, depth - 1);
    if (found) return found;
  }
  return undefined;
}

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
      return path.join(dir, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const found = findFileInTree(path.join(dir, entry.name), filename, depth - 1);
    if (found) return found;
  }
  return undefined;
}
