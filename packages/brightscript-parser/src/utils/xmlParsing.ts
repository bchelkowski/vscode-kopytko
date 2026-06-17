/**
 * SceneGraph XML parsing utilities (pure functions — no file system access).
 *
 * These extract structural information from SceneGraph XML text:
 * - Script URIs from <script> tags
 * - Interface fields and functions from <interface> blocks
 * - Component name and extends from <component> tags
 *
 * File-system-dependent operations (resolving URIs, finding files) stay
 * in the extension's xmlScriptParser.ts.
 */

/**
 * Extracts all script URIs from `<script type="text/brightscript" uri="...">` tags.
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
 * Parses the `<interface>` section of a SceneGraph XML and returns
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
 * Returns the `extends` attribute value from a `<component>` tag, or null.
 */
export function parseXmlExtends(xmlText: string): string | null {
  const match = /<component\b[^>]*\bextends\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match ? match[1] : null;
}

/**
 * Returns the `name` attribute value from a `<component>` tag, or null.
 */
export function parseXmlComponentName(xmlText: string): string | null {
  const match = /<component\b[^>]*\bname\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match ? match[1] : null;
}
