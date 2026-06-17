import * as nodePath from 'path';
import fsWrapper from './fsWrapper';

/**
 * Returns raw URI strings from all <script> tags in an XML text.
 */
export function parseXmlScriptUris(xmlText: string): string[] {
  const uris: string[] = [];
  const pattern = /<script\b[^>]*\buri\s*=\s*"([^"]+)"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xmlText)) !== null) {
    uris.push(match[1]);
  }
  return uris;
}

/**
 * Resolves a script URI from an XML file to an absolute filesystem path.
 * Supports `pkg:/path/file.brs` and relative paths.
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

/**
 * Returns the `extends` attribute value from a <component> tag, or null.
 */
export function parseXmlExtends(xmlText: string): string | null {
  const match = /<component\b[^>]*\bextends\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match ? match[1] : null;
}

/**
 * Returns the `name` attribute value from a <component> tag, or null.
 */
export function parseXmlComponentName(xmlText: string): string | null {
  const match = /<component\b[^>]*\bname\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match ? match[1] : null;
}

export interface XmlInterfaceField {
  name: string;
  type: string;
}

export interface XmlInterfaceFunction {
  name: string;
}

export interface ParsedXmlInterface {
  fields: XmlInterfaceField[];
  functions: XmlInterfaceFunction[];
}

/**
 * Parses the <interface> section of a SceneGraph XML file.
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
      const nameMatch = /<component\b[^>]*\bname\s*=\s*"([^"]+)"/i.exec(text);
      if (nameMatch && nameMatch[1].toLowerCase() === nameLower) {
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
