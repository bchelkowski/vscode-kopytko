/**
 * BrightScript component catalog.
 *
 * Each entry models one ro* object that can be instantiated with CreateObject().
 * Components implement one or more named interfaces (ifXxx); each interface
 * exposes a set of methods.
 *
 * Sourced from the official Roku BrightScript reference:
 *   https://developer.roku.com/dev/docs/brightscript
 *
 * LAST VERIFIED AGAINST ROKU DOCS: 2026-06-04
 * (Update this date whenever the catalog is refreshed from the official docs.
 *  See docs/brightscript-components.md for the change-log.)
 */
interface BrightScriptMethod {
    name: string;
    /** Full BrightScript signature, e.g. `Push(a as Dynamic) as Void` */
    signature: string;
    returnType: string;
    description: string;
    /** Firmware version in which the method was added, if known */
    since?: string;
    /** True when Roku has deprecated this method */
    deprecated?: boolean;
    deprecationNote?: string;
}
interface BrightScriptInterface {
    /** Interface name, e.g. `ifArray` */
    name: string;
    description: string;
    /** URL of the official Roku documentation page for this interface */
    docsUrl: string;
    methods: BrightScriptMethod[];
}
interface BrightScriptComponent {
    /** Component name as passed to CreateObject(), e.g. `roArray` */
    name: string;
    description: string;
    /** URL of the official documentation page */
    docsUrl: string;
    /** Interface names implemented by this component */
    interfaces: string[];
    /** Minimum Roku OS version that supports this component */
    since?: string;
    /** Whether Roku has deprecated this component */
    deprecated?: boolean;
    deprecationNote?: string;
}
export declare const BRIGHTSCRIPT_INTERFACES: Record<string, BrightScriptInterface>;
export declare const BRIGHTSCRIPT_COMPONENTS: BrightScriptComponent[];
export declare function findComponent(name: string): BrightScriptComponent | undefined;
export declare function findInterface(name: string): BrightScriptInterface | undefined;
/**
 * Returns the deduplicated list of BrightScriptMethod objects for all
 * interfaces implemented by the named component.
 */
export declare function getComponentMethods(componentName: string): BrightScriptMethod[];
/**
 * Returns the name of the interface that defines methodName on componentName,
 * or undefined if not found.
 */
export declare function findMethodInterface(componentName: string, methodName: string): BrightScriptInterface | undefined;
/**
 * The date this catalog was last verified against the official Roku docs.
 * Update this constant whenever you synchronise with the live documentation.
 */
export declare const CATALOG_LAST_VERIFIED = "2026-06-04";
export {};
//# sourceMappingURL=components.d.ts.map