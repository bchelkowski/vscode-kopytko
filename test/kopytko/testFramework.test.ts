import { expect } from 'chai';
import {
  isTestFile,
  EXPECT_MATCHERS,
  MOCK_FUNCTION_METHODS,
  ALL_TEST_GLOBALS,
  buildTestApiMap,
} from '../../src/server/kopytko/testFramework';

describe('kopytko/testFramework catalog', () => {
  describe('isTestFile', () => {
    it('returns true for standard test file paths', () => {
      expect(isTestFile('/app/components/about/_tests/AboutView.test.brs')).to.be.true;
      expect(isTestFile('file:///c:/project/app/components/_tests/Foo.test.brs')).to.be.true;
      expect(isTestFile('/components/_tests/Service_Main.test.brs')).to.be.true;
    });

    it('returns false for non-test files', () => {
      expect(isTestFile('/app/components/about/AboutView.brs')).to.be.false;
      expect(isTestFile('/app/components/about/AboutView.template.brs')).to.be.false;
      expect(isTestFile('/app/source/main.brs')).to.be.false;
    });

    it('returns true for .test.brs without _tests directory', () => {
      expect(isTestFile('/app/MyModule.test.brs')).to.be.true;
    });
  });

  describe('EXPECT_MATCHERS', () => {
    it('has all core matchers', () => {
      const names = EXPECT_MATCHERS.map(m => m.name);
      expect(names).to.include('toBe');
      expect(names).to.include('toEqual');
      expect(names).to.include('toBeTrue');
      expect(names).to.include('toBeFalse');
      expect(names).to.include('toBeValid');
      expect(names).to.include('toBeInvalid');
      expect(names).to.include('toContain');
      expect(names).to.include('toHaveKey');
      expect(names).to.include('toHaveKeys');
      expect(names).to.include('toHaveLength');
      expect(names).to.include('toThrow');
      expect(names).to.include('toHaveBeenCalled');
      expect(names).to.include('toHaveBeenCalledTimes');
      expect(names).to.include('toHaveBeenCalledWith');
      expect(names).to.include('toHaveBeenLastCalledWith');
      expect(names).to.include('toHaveBeenNthCalledWith');
      expect(names).to.include('not');
    });

    it('each matcher has required fields', () => {
      for (const matcher of EXPECT_MATCHERS) {
        expect(matcher.name).to.be.a('string').that.is.not.empty;
        expect(matcher.signature).to.be.a('string').that.is.not.empty;
        expect(matcher.description).to.be.a('string').that.is.not.empty;
        expect(matcher.context).to.equal('expect');
      }
    });
  });

  describe('MOCK_FUNCTION_METHODS', () => {
    it('has all mock methods', () => {
      const names = MOCK_FUNCTION_METHODS.map(m => m.name);
      expect(names).to.include('returnValue');
      expect(names).to.include('resolvedValue');
      expect(names).to.include('rejectedValue');
      expect(names).to.include('implementation');
      expect(names).to.include('throw');
      expect(names).to.include('clear');
      expect(names).to.include('getCalls');
      expect(names).to.include('getConstructorCalls');
      expect(names).to.include('setProperty');
      expect(names).to.include('setProperties');
    });

    it('each method has context mockFunction', () => {
      for (const method of MOCK_FUNCTION_METHODS) {
        expect(method.context).to.equal('mockFunction');
      }
    });
  });

  describe('ALL_TEST_GLOBALS', () => {
    it('includes test registration functions', () => {
      const names = ALL_TEST_GLOBALS.map(g => g.name);
      expect(names).to.include('it');
      expect(names).to.include('test');
      expect(names).to.include('itEach');
      expect(names).to.include('testEach');
      expect(names).to.include('beforeAll');
      expect(names).to.include('beforeEach');
      expect(names).to.include('afterEach');
      expect(names).to.include('afterAll');
      expect(names).to.include('expect');
      expect(names).to.include('mockFunction');
      expect(names).to.include('ts');
    });

    it('includes test utilities', () => {
      const names = ALL_TEST_GLOBALS.map(g => g.name);
      expect(names).to.include('fakeClock');
      expect(names).to.include('initKopytko');
      expect(names).to.include('forceUpdate');
    });
  });

  describe('buildTestApiMap', () => {
    it('builds a map of all test API entries', () => {
      const map = buildTestApiMap();
      expect(map.get('tobe')).to.not.be.undefined;
      expect(map.get('tobe')!.name).to.equal('toBe');
      expect(map.get('mockfunction')).to.not.be.undefined;
      expect(map.get('returnvalue')).to.not.be.undefined;
      expect(map.get('it')).to.not.be.undefined;
      expect(map.get('tick')).to.not.be.undefined;
    });
  });
});
