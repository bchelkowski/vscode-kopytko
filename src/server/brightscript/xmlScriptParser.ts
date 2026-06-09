import * as path from 'path';
import fsWrapper from '../utils/fsWrapper';

/**
 * Returns the raw URI strings from all <script type="text/brightscript"> tags
 * in the given XML text.
 */
export function parseXmlScriptUris(xmlText: string): string[] {
  const uris: string[] = [];
  // Match both attribute orderings: uri= before or after type=
  const pattern = /<script\b[^>]*\buri\s*=\s*"([^"]+)"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xmlText)) !== null) {
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
  let entries: string[];
  try {
    entries = fsWrapper.readdirSync(dir);
  } catch {
    return [];
  }
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

  const ifaceMatch = /<interface\b[^>]*>([\s\S]*?)<\/interface>/i.exec(xmlText);
  if (!ifaceMatch) return { fields, functions };
  const ifaceText = ifaceMatch[1];

  const fieldRe = /<field\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(ifaceText)) !== null) {
    const attrs = m[1];
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const typeMatch = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (idMatch) {
      fields.push({ name: idMatch[1], type: typeMatch ? typeMatch[1] : 'dynamic' });
    }
  }

  const funcRe = /<function\b([^>]*)>/gi;
  while ((m = funcRe.exec(ifaceText)) !== null) {
    const attrs = m[1];
    const nameMatch = /\bname\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (nameMatch) functions.push({ name: nameMatch[1] });
  }

  return { fields, functions };
}

/**
 * Returns the component name from the `extends` attribute of a <component> tag,
 * or null if not present.
 */
export function parseXmlExtends(xmlText: string): string | null {
  const match = /<component\b[^>]*\bextends\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match ? match[1] : null;
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
      const nameMatch = /<component\b[^>]*\bname\s*=\s*"([^"]+)"/i.exec(text);
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
