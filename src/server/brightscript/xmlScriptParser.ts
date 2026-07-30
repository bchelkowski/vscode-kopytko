import * as path from 'path';
import fsWrapper from '../utils/fsWrapper';

// Hoisted to module scope to avoid recompiling on every XML parse (these run
// during type inference, completion, and extends-chain resolution). The global
// (`g`) patterns carry lastIndex state, so each use resets lastIndex before its
// loop — safe because all calls are synchronous and run to completion.
const SCRIPT_URI_RE = /<script\b[^>]*\buri\s*=\s*"([^"]+)"[^>]*>/gi;
const INTERFACE_BLOCK_RE = /<interface\b[^>]*>([\s\S]*?)<\/interface>/i;
const FIELD_TAG_RE = /<field\b([^>]*)>/gi;
const FUNCTION_TAG_RE = /<function\b([^>]*)>/gi;
const ATTR_ID_RE = /\bid\s*=\s*["']([^"']+)["']/i;
const ATTR_TYPE_RE = /\btype\s*=\s*["']([^"']+)["']/i;
const ATTR_NAME_RE = /\bname\s*=\s*["']([^"']+)["']/i;
const COMPONENT_EXTENDS_RE = /<component\b[^>]*\bextends\s*=\s*["']([^"']+)["']/i;
const COMPONENT_NAME_RE = /<component\b[^>]*\bname\s*=\s*"([^"]+)"/i;
const COMPONENT_TAG_RE = /<component\b([^>]*)>/i;
const ATTR_NAME_VALUE_RE = /\bname\s*=\s*["']([^"']+)["']/i;
const ATTR_EXTENDS_VALUE_RE = /\bextends\s*=\s*["']([^"']+)["']/i;

/**
 * Returns the raw URI strings from all <script type="text/brightscript"> tags
 * in the given XML text.
 */
export function parseXmlScriptUris(xmlText: string): string[] {
  const uris: string[] = [];
  // Match both attribute orderings: uri= before or after type=
  SCRIPT_URI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCRIPT_URI_RE.exec(xmlText)) !== null) {
    uris.push(match[1]);
  }
  return uris;
}

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

// ── XML interface parser ──────────────────────────────────────────────────

interface XmlInterfaceField {
  name: string;
  type: string;
}

interface XmlInterfaceFunction {
  name: string;
}

interface ParsedXmlInterface {
  fields: XmlInterfaceField[];
  functions: XmlInterfaceFunction[];
}

/**
 * Parses the `<interface>` section of a SceneGraph XML file and returns the
 * declared `<field>` and `<function>` entries.
 */
export function parseXmlInterface(xmlText: string): ParsedXmlInterface {
  const fields: XmlInterfaceField[] = [];
  const functions: XmlInterfaceFunction[] = [];

  const ifaceMatch = INTERFACE_BLOCK_RE.exec(xmlText);
  if (!ifaceMatch) return { fields, functions };
  const ifaceText = ifaceMatch[1];

  FIELD_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_TAG_RE.exec(ifaceText)) !== null) {
    const attrs = m[1];
    const idMatch = ATTR_ID_RE.exec(attrs);
    const typeMatch = ATTR_TYPE_RE.exec(attrs);
    if (idMatch) {
      fields.push({ name: idMatch[1], type: typeMatch ? typeMatch[1] : 'dynamic' });
    }
  }

  FUNCTION_TAG_RE.lastIndex = 0;
  while ((m = FUNCTION_TAG_RE.exec(ifaceText)) !== null) {
    const attrs = m[1];
    const nameMatch = ATTR_NAME_RE.exec(attrs);
    if (nameMatch) functions.push({ name: nameMatch[1] });
  }

  return { fields, functions };
}

/**
 * Returns the component name from the `extends` attribute of a <component> tag,
 * or null if not present.
 */
export function parseXmlExtends(xmlText: string): string | null {
  const match = COMPONENT_EXTENDS_RE.exec(xmlText);
  return match ? match[1] : null;
}

/** A `<component>` tag's declared name and parent, with source positions. */
export interface ComponentTagInfo {
  name: string;
  /** Zero-based line of the `<component` tag itself. */
  tagLine: number;
  /** Zero-based position of the first character of the `name` attribute value. */
  nameLine: number;
  nameColumn: number;
  extendsName?: string;
  /** Zero-based position of the first character of the `extends` attribute value. */
  extendsLine?: number;
  extendsColumn?: number;
}

/**
 * Parses the `<component>` tag of a SceneGraph XML file, returning its `name`,
 * its `extends` parent, and the source position of each attribute *value*.
 *
 * `parseXmlExtends` answers "what does this extend"; this answers "…and where is
 * that written", which is what navigation features need in order to place a
 * cursor. Returns undefined when the file declares no named component.
 */
export function parseComponentTag(xmlText: string): ComponentTagInfo | undefined {
  const tagMatch = COMPONENT_TAG_RE.exec(xmlText);
  if (!tagMatch) return undefined;

  const attrs = tagMatch[1];
  // Offset of the attribute list within the document ('<component'.length === 10)
  const attrsStart = tagMatch.index + 10;

  const nameMatch = ATTR_NAME_VALUE_RE.exec(attrs);
  if (!nameMatch) return undefined;
  const namePos = offsetToPosition(xmlText, attrsStart + valueOffsetIn(nameMatch));

  const info: ComponentTagInfo = {
    name: nameMatch[1],
    tagLine: offsetToPosition(xmlText, tagMatch.index).line,
    nameLine: namePos.line,
    nameColumn: namePos.column,
  };

  const extendsMatch = ATTR_EXTENDS_VALUE_RE.exec(attrs);
  if (extendsMatch) {
    const extendsPos = offsetToPosition(xmlText, attrsStart + valueOffsetIn(extendsMatch));
    info.extendsName = extendsMatch[1];
    info.extendsLine = extendsPos.line;
    info.extendsColumn = extendsPos.column;
  }

  return info;
}

/** Offset of an attribute's value (past the opening quote) within its subject text. */
function valueOffsetIn(attrMatch: RegExpExecArray): number {
  return attrMatch.index + attrMatch[0].search(/["']/) + 1;
}

/** Converts a character offset into a zero-based line/column pair. */
function offsetToPosition(text: string, offset: number): { line: number; column: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart };
}

/**
 * Memoizes component-name → XML-path resolution, including negative results.
 * `findComponentXml` does full recursive directory walks (reading and
 * regex-scanning every XML), and is called for each link in an `extends` chain
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
  const cacheKey = `${componentName.toLowerCase()} ${maxDepth} ${searchRoots.join(' ')}`;
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
      const nameMatch = COMPONENT_NAME_RE.exec(text);
      if (nameMatch && nameMatch[1].toLowerCase() === nameLower) {
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
