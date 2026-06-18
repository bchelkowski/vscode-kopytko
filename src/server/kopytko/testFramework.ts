/**
 * Kopytko Unit Testing Framework API catalog.
 *
 * Provides completions, hover documentation, and diagnostics for:
 * - expect() matchers
 * - mockFunction() methods
 * - KopytkoTestSuite / KopytkoFrameworkTestSuite methods
 * - Global test helper functions (it, test, beforeEach, etc.)
 * - Test utilities (fakeClock, initKopytko, forceUpdate)
 */

export interface TestApiEntry {
  name: string;
  signature: string;
  returnType: string;
  description: string;
  /** If this method belongs to a chain (e.g. expect().toBe) */
  context?: 'expect' | 'mockFunction' | 'testSuite' | 'global' | 'fakeClock';
}

// ─── expect() matchers ──────────────────────────────────────────────────────

export const EXPECT_MATCHERS: TestApiEntry[] = [
  {
    name: 'toBe',
    signature: 'toBe(expected as Dynamic) as String',
    returnType: 'String',
    description: 'Strict equality for primitives. Fails for objects/arrays — use `toEqual` instead.',
    context: 'expect',
  },
  {
    name: 'toBeTrue',
    signature: 'toBeTrue() as String',
    returnType: 'String',
    description: 'Asserts the value is `true`.',
    context: 'expect',
  },
  {
    name: 'toBeFalse',
    signature: 'toBeFalse() as String',
    returnType: 'String',
    description: 'Asserts the value is `false`.',
    context: 'expect',
  },
  {
    name: 'toBeValid',
    signature: 'toBeValid() as String',
    returnType: 'String',
    description: 'Asserts the value is not `Invalid`.',
    context: 'expect',
  },
  {
    name: 'toBeInvalid',
    signature: 'toBeInvalid() as String',
    returnType: 'String',
    description: 'Asserts the value is `Invalid`.',
    context: 'expect',
  },
  {
    name: 'toEqual',
    signature: 'toEqual(expected as Dynamic) as String',
    returnType: 'String',
    description: 'Deep equality comparison. Works for objects, arrays, and SceneGraph nodes (compared by field values and children).',
    context: 'expect',
  },
  {
    name: 'toContain',
    signature: 'toContain(value as Dynamic) as String',
    returnType: 'String',
    description: 'Array: element is present. AssociativeArray: subset match. Node: has matching fields or child node.',
    context: 'expect',
  },
  {
    name: 'toHaveKey',
    signature: 'toHaveKey(key as String) as String',
    returnType: 'String',
    description: 'Asserts the AssociativeArray contains the given key.',
    context: 'expect',
  },
  {
    name: 'toHaveKeys',
    signature: 'toHaveKeys(keys as Object) as String',
    returnType: 'String',
    description: 'Asserts the AssociativeArray contains all given keys.',
    context: 'expect',
  },
  {
    name: 'toHaveLength',
    signature: 'toHaveLength(count as Integer) as String',
    returnType: 'String',
    description: 'Asserts the array or AssociativeArray has the given element count.',
    context: 'expect',
  },
  {
    name: 'toThrow',
    signature: 'toThrow(expectedError = Invalid as Dynamic) as String',
    returnType: 'String',
    description: 'Asserts the received function reference throws an error. Optionally match error string or error AA.',
    context: 'expect',
  },
  {
    name: 'toHaveBeenCalled',
    signature: 'toHaveBeenCalled() as String',
    returnType: 'String',
    description: 'Asserts the mock function was called at least once. Pass mock name as string to `expect()`.',
    context: 'expect',
  },
  {
    name: 'toHaveBeenCalledTimes',
    signature: 'toHaveBeenCalledTimes(count as Integer) as String',
    returnType: 'String',
    description: 'Asserts the mock function was called exactly N times.',
    context: 'expect',
  },
  {
    name: 'toHaveBeenCalledWith',
    signature: 'toHaveBeenCalledWith(params as Object, options = {} as Object) as String',
    returnType: 'String',
    description: 'Asserts any call to the mock matched the given params (subset match). Use `options.strict = true` for exact 1:1 match.',
    context: 'expect',
  },
  {
    name: 'toHaveBeenLastCalledWith',
    signature: 'toHaveBeenLastCalledWith(params as Object, options = {} as Object) as String',
    returnType: 'String',
    description: 'Asserts the last call to the mock matched the given params.',
    context: 'expect',
  },
  {
    name: 'toHaveBeenNthCalledWith',
    signature: 'toHaveBeenNthCalledWith(nthCall as Integer, params as Object, options = {} as Object) as String',
    returnType: 'String',
    description: 'Asserts the Nth call (1-indexed) to the mock matched the given params.',
    context: 'expect',
  },
  {
    name: 'not',
    signature: 'not',
    returnType: 'Object',
    description: 'Negates the following matcher. Example: `expect(value).not.toBe(4)`.',
    context: 'expect',
  },
];

// ─── mockFunction() methods ─────────────────────────────────────────────────

export const MOCK_FUNCTION_METHODS: TestApiEntry[] = [
  {
    name: 'returnValue',
    signature: 'returnValue(value as Dynamic)',
    returnType: 'Void',
    description: 'Sets a fixed return value for the mocked function.',
    context: 'mockFunction',
  },
  {
    name: 'resolvedValue',
    signature: 'resolvedValue(value as Dynamic)',
    returnType: 'Void',
    description: 'Sets the mock to return a resolved promise with the given value. Requires `PromiseResolve` import.',
    context: 'mockFunction',
  },
  {
    name: 'rejectedValue',
    signature: 'rejectedValue(error as Dynamic)',
    returnType: 'Void',
    description: 'Sets the mock to return a rejected promise with the given error. Requires `PromiseReject` import.',
    context: 'mockFunction',
  },
  {
    name: 'implementation',
    signature: 'implementation(func as Function)',
    returnType: 'Void',
    description: 'Provides a custom implementation. The function receives `(params as Object, context as Object)` where context is the test scope.',
    context: 'mockFunction',
  },
  {
    name: 'throw',
    signature: 'throw(error as Dynamic)',
    returnType: 'Void',
    description: 'Makes the mocked function throw the given error (string or error AA).',
    context: 'mockFunction',
  },
  {
    name: 'clear',
    signature: 'clear()',
    returnType: 'Void',
    description: 'Clears all recorded calls and configured return values for this mock.',
    context: 'mockFunction',
  },
  {
    name: 'getCalls',
    signature: 'getCalls() as Object',
    returnType: 'roArray',
    description: 'Returns an array of call records. Each record has a `params` field with the arguments passed.',
    context: 'mockFunction',
  },
  {
    name: 'getConstructorCalls',
    signature: 'getConstructorCalls() as Object',
    returnType: 'roArray',
    description: 'Returns an array of constructor call records for object mocks.',
    context: 'mockFunction',
  },
  {
    name: 'setProperty',
    signature: 'setProperty(name as String, value as Dynamic)',
    returnType: 'Void',
    description: 'Sets a property on the object returned by the mocked constructor.',
    context: 'mockFunction',
  },
  {
    name: 'setProperties',
    signature: 'setProperties(properties as Object)',
    returnType: 'Void',
    description: 'Sets multiple properties on the object returned by the mocked constructor.',
    context: 'mockFunction',
  },
];

// ─── Test suite methods (ts.) ───────────────────────────────────────────────

export const TEST_SUITE_METHODS: TestApiEntry[] = [
  {
    name: 'addTest',
    signature: 'addTest(name as String, func as Function, setup = Invalid, teardown = Invalid)',
    returnType: 'Void',
    description: 'Registers a test case with the suite. Prefer using `it()` or `test()` shorthands.',
    context: 'testSuite',
  },
  {
    name: 'addParameterizedTests',
    signature: 'addParameterizedTests(paramsList as Object, testName as String, func as Function)',
    returnType: 'Void',
    description: 'Registers parameterized tests. Test name supports `${key}` placeholders for AA params.',
    context: 'testSuite',
  },
  {
    name: 'setBeforeAll',
    signature: 'setBeforeAll(callback as Function)',
    returnType: 'Void',
    description: 'Sets a function to run once before all tests in the suite.',
    context: 'testSuite',
  },
  {
    name: 'setBeforeEach',
    signature: 'setBeforeEach(callback as Function)',
    returnType: 'Void',
    description: 'Sets a function to run before each test case.',
    context: 'testSuite',
  },
  {
    name: 'setAfterEach',
    signature: 'setAfterEach(callback as Function)',
    returnType: 'Void',
    description: 'Sets a function to run after each test case.',
    context: 'testSuite',
  },
  {
    name: 'setAfterAll',
    signature: 'setAfterAll(callback as Function)',
    returnType: 'Void',
    description: 'Sets a function to run once after all tests in the suite.',
    context: 'testSuite',
  },
  {
    name: 'assertMethodWasCalled',
    signature: 'assertMethodWasCalled(methodPath as String, params = {} as Object, options = {} as Object, msg = "" as String) as String',
    returnType: 'String',
    description: 'Asserts a mocked method was called with given params. `options.times` for exact count, `options.strict` for exact match.',
    context: 'testSuite',
  },
  {
    name: 'assertMethodWasNotCalled',
    signature: 'assertMethodWasNotCalled(methodPath as String, params = {} as Object, options = {} as Object, msg = "" as String) as String',
    returnType: 'String',
    description: 'Asserts a mocked method was NOT called with given params.',
    context: 'testSuite',
  },
  {
    name: 'wasMethodCalled',
    signature: 'wasMethodCalled(methodPath as String, params = {} as Object, options = {} as Object) as Boolean',
    returnType: 'Boolean',
    description: 'Returns whether a mocked method was called with given params. Use in conditionals.',
    context: 'testSuite',
  },
  {
    name: 'assertNodesAreEqual',
    signature: 'assertNodesAreEqual(expected as Object, tested as Object, msg = "" as String) as String',
    returnType: 'String',
    description: 'Deep comparison of two SceneGraph nodes (fields and children).',
    context: 'testSuite',
  },
  {
    name: 'assertDataWasSetOnStore',
    signature: 'assertDataWasSetOnStore(data as Object, msg = "" as String) as String',
    returnType: 'String',
    description: 'Asserts `StoreFacade.set` was called with the given data. (KopytkoFrameworkTestSuite only)',
    context: 'testSuite',
  },
  {
    name: 'assertRequestWasMade',
    signature: 'assertRequestWasMade(params as Object, options = {} as Object, msg = "" as String) as String',
    returnType: 'String',
    description: 'Asserts `createRequest` was called with the given params. (KopytkoFrameworkTestSuite only)',
    context: 'testSuite',
  },
  {
    name: 'isMatch',
    signature: 'isMatch(valueA as Dynamic, valueB as Dynamic) as Boolean',
    returnType: 'Boolean',
    description: 'Partial/subset deep matching. Returns true if valueB is a subset of valueA.',
    context: 'testSuite',
  },
  {
    name: 'findLabelByText',
    signature: 'findLabelByText(query as String, container = Invalid as Object) as Object',
    returnType: 'Object',
    description: 'Finds a Label node by text content or regex pattern (format: `/pattern/flags`).',
    context: 'testSuite',
  },
];

// ─── Global test helper functions ───────────────────────────────────────────

export const GLOBAL_TEST_FUNCTIONS: TestApiEntry[] = [
  {
    name: 'it',
    signature: 'it(testName as String, func as Function)',
    returnType: 'Void',
    description: 'Registers a test case. Prepends "it " to the test name. The function should return a String (empty = pass) or an array of assertion results.',
    context: 'global',
  },
  {
    name: 'test',
    signature: 'test(testName as String, func as Function)',
    returnType: 'Void',
    description: 'Registers a test case with the exact given name. The function should return a String (empty = pass) or an array of assertion results.',
    context: 'global',
  },
  {
    name: 'itEach',
    signature: 'itEach(paramsList as Object, testName as String, func as Function)',
    returnType: 'Void',
    description: 'Registers parameterized tests (prepends "it "). Test name supports `${key}` placeholders for AA params. Function receives `(params as Object)`.',
    context: 'global',
  },
  {
    name: 'testEach',
    signature: 'testEach(paramsList as Object, testName as String, func as Function)',
    returnType: 'Void',
    description: 'Registers parameterized tests with exact name. Test name supports `${key}` placeholders for AA params. Function receives `(params as Object)`.',
    context: 'global',
  },
  {
    name: 'beforeAll',
    signature: 'beforeAll(callback as Function)',
    returnType: 'Void',
    description: 'Registers a callback to run once before all tests in the suite.',
    context: 'global',
  },
  {
    name: 'beforeEach',
    signature: 'beforeEach(callback as Function)',
    returnType: 'Void',
    description: 'Registers a callback to run before each test case. Commonly used to set up `m.__mocks` and test data.',
    context: 'global',
  },
  {
    name: 'afterEach',
    signature: 'afterEach(callback as Function)',
    returnType: 'Void',
    description: 'Registers a callback to run after each test case.',
    context: 'global',
  },
  {
    name: 'afterAll',
    signature: 'afterAll(callback as Function)',
    returnType: 'Void',
    description: 'Registers a callback to run once after all tests in the suite.',
    context: 'global',
  },
  {
    name: 'getTestSuite',
    signature: 'getTestSuite() as Object',
    returnType: 'Object',
    description: 'Returns the current test suite object. Backed by `GetGlobalAA()["$$ts"]`.',
    context: 'global',
  },
  {
    name: 'expect',
    signature: 'expect(value as Dynamic) as Object',
    returnType: 'Object',
    description: 'Creates an expectation object for the given value. Chain with a matcher: `.toBe()`, `.toEqual()`, `.toHaveBeenCalled()`, etc.',
    context: 'global',
  },
  {
    name: 'mockFunction',
    signature: 'mockFunction(functionName as String) as Object',
    returnType: 'Object',
    description: 'Gets a mock controller for the named function. Use dot notation for methods: `mockFunction("Service.method")`. Chain with `.returnValue()`, `.implementation()`, etc.',
    context: 'global',
  },
  {
    name: 'Mock',
    signature: 'Mock(options as Object) as Dynamic',
    returnType: 'Dynamic',
    description: 'Creates a mock object/function/node based on options. Used in manual mock files (`_mocks/*.mock.brs`). Auto-detects type: ObjectMock (if `.methods`), NodeMock (if `.fields`), or FunctionMock.',
    context: 'global',
  },
];

// ─── Test utilities ─────────────────────────────────────────────────────────

export const TEST_UTILITIES: TestApiEntry[] = [
  {
    name: 'fakeClock',
    signature: 'fakeClock(scope as Object) as Object',
    returnType: 'Object',
    description: 'Creates a fake clock for testing setTimeout/setInterval. Pass the component scope (`m`). Use `.tick(ms)` to advance time.',
    context: 'global',
  },
  {
    name: 'initKopytko',
    signature: 'initKopytko(props = {} as Object, componentsMapping = {} as Object)',
    returnType: 'Void',
    description: 'Initializes a Kopytko component for testing with the given props and mock component mappings.',
    context: 'global',
  },
  {
    name: 'forceUpdate',
    signature: 'forceUpdate()',
    returnType: 'Void',
    description: 'Forces a synchronous render cycle on the component under test.',
    context: 'global',
  },
];

export const FAKE_CLOCK_METHODS: TestApiEntry[] = [
  {
    name: 'tick',
    signature: 'tick(milliseconds as Integer)',
    returnType: 'Void',
    description: 'Advances the fake clock by the given number of milliseconds, firing any pending timers.',
    context: 'fakeClock',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a file URI or path looks like a test file. */
export function isTestFile(uriOrPath: string): boolean {
  return /[/\\]_tests[/\\].*\.test\.brs$/i.test(uriOrPath) || /\.test\.brs$/i.test(uriOrPath);
}

/** Check if a file URI or path looks like a mock file. */
export function isMockFile(uriOrPath: string): boolean {
  return /[/\\]_mocks[/\\].*\.mock\.brs$/i.test(uriOrPath) || /\.mock\.brs$/i.test(uriOrPath);
}

/** Check if a file is test-related (test or mock) — gets test framework globals. */
export function isTestRelatedFile(uriOrPath: string): boolean {
  return isTestFile(uriOrPath) || isMockFile(uriOrPath);
}

/**
 * Extracts the base test name from a test file path.
 * `Foo.test.brs` → `Foo`, `Foo_Bar.test.brs` → `Foo`
 */
export function getTestBaseName(testFilePath: string): string {
  const basename = testFilePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.test\.brs$/i, '') ?? '';
  const underscoreIdx = basename.indexOf('_');
  return underscoreIdx > 0 ? basename.substring(0, underscoreIdx) : basename;
}

/** All global functions available in test files. */
export const ALL_TEST_GLOBALS: TestApiEntry[] = [
  ...GLOBAL_TEST_FUNCTIONS,
  ...TEST_UTILITIES,
];

/** Build a lookup map for fast name-based search. */
export function buildTestApiMap(): Map<string, TestApiEntry> {
  const map = new Map<string, TestApiEntry>();
  for (const entry of [
    ...EXPECT_MATCHERS,
    ...MOCK_FUNCTION_METHODS,
    ...TEST_SUITE_METHODS,
    ...ALL_TEST_GLOBALS,
    ...FAKE_CLOCK_METHODS,
  ]) {
    map.set(entry.name.toLowerCase(), entry);
  }
  return map;
}
