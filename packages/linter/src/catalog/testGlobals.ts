/**
 * Kopytko test framework global functions.
 * Available in all .test.brs files without explicit @import.
 *
 * Kept in sync with the extension's src/server/kopytko/testFramework.ts.
 */

export const TEST_FRAMEWORK_GLOBALS: string[] = [
  // Test suite helpers
  'it', 'test', 'iteach', 'testeach',
  'beforeeach', 'aftereach', 'beforeall', 'afterall',
  // Assertions & mocking
  'expect', 'mockfunction', 'mock',
  // Test utilities
  'fakeclock', 'initkopytko', 'forceupdate', 'destroykopytko',
  // Test suite accessor
  'gettestsuite',
];
