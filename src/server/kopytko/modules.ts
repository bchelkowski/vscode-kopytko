/**
 * Known Kopytko modules and their public APIs.
 * Used for completion and hover documentation.
 */
export interface KopytkoModuleInfo {
  name: string;
  npmPackage: string;
  description: string;
  /** Key public functions/subs exported by this module. */
  exports: KopytkoExport[];
}

export interface KopytkoExport {
  name: string;
  kind: 'function' | 'sub' | 'component';
  signature?: string;
  description: string;
}

export const KOPYTKO_MODULES: KopytkoModuleInfo[] = [
  {
    name: 'Renderer',
    npmPackage: '@dazn/kopytko-framework',
    description: 'Main Kopytko module inspired by React. Manages component rendering and state.',
    exports: [
      {
        name: 'setState',
        kind: 'sub',
        signature: 'setState(newState as Object)',
        description: 'Merges newState into the component state and triggers a re-render.',
      },
      {
        name: 'getState',
        kind: 'function',
        signature: 'getState() as Object',
        description: 'Returns the current component state.',
      },
      {
        name: 'render',
        kind: 'function',
        signature: 'render() as Object',
        description: 'Returns the component tree description. Override in your component.',
      },
    ],
  },
  {
    name: 'Router',
    npmPackage: '@dazn/kopytko-framework',
    description: 'Enables multi-view navigation in Kopytko apps.',
    exports: [
      {
        name: 'navigate',
        kind: 'sub',
        signature: 'navigate(route as String, params = {} as Object)',
        description: 'Navigate to a named route with optional parameters.',
      },
      {
        name: 'goBack',
        kind: 'sub',
        signature: 'goBack()',
        description: 'Navigate to the previous route in the history stack.',
      },
    ],
  },
  {
    name: 'EventBus',
    npmPackage: '@dazn/kopytko-framework',
    description: 'Pub/Sub implementation for decoupled component communication.',
    exports: [
      {
        name: 'emit',
        kind: 'sub',
        signature: 'emit(eventName as String, data = invalid as Dynamic)',
        description: 'Emit a named event with optional data payload.',
      },
      {
        name: 'on',
        kind: 'sub',
        signature: 'on(eventName as String, handlerName as String)',
        description: 'Subscribe to a named event, calling the given handler function.',
      },
      {
        name: 'off',
        kind: 'sub',
        signature: 'off(eventName as String, handlerName as String)',
        description: 'Unsubscribe a handler from a named event.',
      },
    ],
  },
  {
    name: 'Store',
    npmPackage: '@dazn/kopytko-framework',
    description: 'Global reactive data store for sharing state across components.',
    exports: [
      {
        name: 'getStore',
        kind: 'function',
        signature: 'getStore() as Object',
        description: 'Returns the current store state.',
      },
      {
        name: 'dispatch',
        kind: 'sub',
        signature: 'dispatch(action as String, payload = invalid as Dynamic)',
        description: 'Dispatch an action to update the store.',
      },
    ],
  },
  {
    name: 'HTTP',
    npmPackage: '@dazn/kopytko-framework',
    description: 'Simple HTTP request abstraction for Kopytko apps.',
    exports: [
      {
        name: 'httpGet',
        kind: 'function',
        signature: 'httpGet(url as String, options = {} as Object) as Object',
        description: 'Perform a GET request and return a task node.',
      },
      {
        name: 'httpPost',
        kind: 'function',
        signature: 'httpPost(url as String, body as Object, options = {} as Object) as Object',
        description: 'Perform a POST request and return a task node.',
      },
    ],
  },
  {
    name: 'Cache',
    npmPackage: '@dazn/kopytko-framework',
    description: 'Mechanism to store expirable external data.',
    exports: [
      {
        name: 'setCache',
        kind: 'sub',
        signature: 'setCache(key as String, value as Dynamic, ttl = 0 as Integer)',
        description: 'Store a value in the cache with an optional TTL in seconds.',
      },
      {
        name: 'getCache',
        kind: 'function',
        signature: 'getCache(key as String) as Dynamic',
        description: 'Retrieve a cached value, returning invalid if expired or missing.',
      },
    ],
  },
];

/**
 * Look up module info by NPM package name.
 */
export function getModuleByPackage(packageName: string): KopytkoModuleInfo | undefined {
  return KOPYTKO_MODULES.find((m) => m.npmPackage === packageName);
}

/**
 * Find an export definition by function/sub name across all modules.
 */
export function findExport(name: string): { module: KopytkoModuleInfo; export: KopytkoExport } | undefined {
  for (const mod of KOPYTKO_MODULES) {
    const exp = mod.exports.find(
      (e) => e.name.toLowerCase() === name.toLowerCase()
    );
    if (exp) {
      return { module: mod, export: exp };
    }
  }
  return undefined;
}
