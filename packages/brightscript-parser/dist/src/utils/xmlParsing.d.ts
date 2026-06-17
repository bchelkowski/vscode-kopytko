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
export declare function parseXmlScriptUris(xmlText: string): string[];
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
export declare function parseXmlInterface(xmlText: string): ParsedXmlInterface;
/**
 * Returns the `extends` attribute value from a `<component>` tag, or null.
 */
export declare function parseXmlExtends(xmlText: string): string | null;
/**
 * Returns the `name` attribute value from a `<component>` tag, or null.
 */
export declare function parseXmlComponentName(xmlText: string): string | null;
//# sourceMappingURL=xmlParsing.d.ts.map