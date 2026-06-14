import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/analysis/fsWrapper';
import { isTestFile, resolveTestedFiles, findTestSiblings } from '../../src/analysis/testUtils';

describe('testUtils', () => {
  let existsStub: sinon.SinonStub;
  let readdirStub: sinon.SinonStub;

  beforeEach(() => {
    existsStub = sinon.stub(fsWrapper, 'existsSync');
    readdirStub = sinon.stub(fsWrapper, 'readdirSync');
    existsStub.returns(false);
  });

  afterEach(() => sinon.restore());

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

  // ── resolveTestedFiles ─────────────────────────────────────────────────────

  describe('resolveTestedFiles', () => {
    it('resolves Foo.test.brs to ../Foo.brs when it exists', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/Foo.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/Foo.test.brs');
      expect(result).to.include('/project/app/components/Foo.brs');
    });

    it('resolves to component variant (Foo.component.brs)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/Foo.component.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/Foo.test.brs');
      expect(result).to.include('/project/app/components/Foo.component.brs');
    });

    it('resolves split suite (Foo_Bar.test.brs) to ../Foo.brs', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/Foo.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/Foo_Bar.test.brs');
      expect(result).to.include('/project/app/components/Foo.brs');
    });

    it('resolves split suite to component variant', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/Some.view.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/Some_Main.test.brs');
      expect(result).to.include('/project/app/components/Some.view.brs');
    });

    it('returns empty when no matching file exists', () => {
      existsStub.returns(false);
      const result = resolveTestedFiles('/project/app/components/_tests/NoMatch.test.brs');
      expect(result).to.be.empty;
    });

    it('resolves nested _tests subdirectory', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/browse/rails/RailsService.component.brs');
      const result = resolveTestedFiles('/project/app/components/browse/rails/_tests/RailsService/RailsService_fetch.test.brs');
      expect(result).to.include('/project/app/components/browse/rails/RailsService.component.brs');
    });

    it('resolves nested _tests subdirectory for plain .brs (non-split)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/rails/RailsService.brs');
      const result = resolveTestedFiles('/project/app/components/rails/_tests/RailsService/RailsService.test.brs');
      expect(result).to.include('/project/app/components/rails/RailsService.brs');
    });

    it('resolves PascalCase-suffix test (SomePageView.test.brs → SomePage.view.brs)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/SomePage.view.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/SomePageView.test.brs');
      expect(result).to.include('/project/app/components/SomePage.view.brs');
    });

    it('resolves PascalCase-suffix test (SomeServiceService.test.brs → SomeService.service.brs)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/SomeService.service.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/SomeServiceService.test.brs');
      expect(result).to.include('/project/app/components/SomeService.service.brs');
    });

    it('resolves split suite with PascalCase-suffix', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/SomeService.service.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/SomeServiceService_fetch.test.brs');
      expect(result).to.include('/project/app/components/SomeService.service.brs');
    });

    it('resolves PascalCase-suffix test (FooComponent.test.brs → Foo.component.brs)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/Foo.component.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/FooComponent.test.brs');
      expect(result).to.include('/project/app/components/Foo.component.brs');
    });

    it('still resolves exact match when no suffix split applies', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/FooService.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/FooService.test.brs');
      expect(result).to.include('/project/app/components/FooService.brs');
    });

    it('resolves any arbitrary suffix', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/SomeFoo.widget.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/SomeFooWidget.test.brs');
      expect(result).to.include('/project/app/components/SomeFoo.widget.brs');
    });

    it('resolves multi-word suffix', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/SomeFooBar.baz.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/SomeFooBarBaz.test.brs');
      expect(result).to.include('/project/app/components/SomeFooBar.baz.brs');
    });
  });

  // ── findTestSiblings ────────────────────────────────────────────────────────

  describe('findTestSiblings', () => {
    it('finds split suite siblings (Foo.test.brs sees Foo_Bar.test.brs)', () => {
      readdirStub.returns(['Foo.test.brs', 'Foo_Bar.test.brs', 'Foo_Baz.test.brs', 'Other.test.brs']);
      const result = findTestSiblings('/project/_tests/Foo.test.brs');
      expect(result).to.have.lengthOf(2);
      expect(result.map((p: string) => p.replace(/\\/g, '/'))).to.include('/project/_tests/Foo_Bar.test.brs');
      expect(result.map((p: string) => p.replace(/\\/g, '/'))).to.include('/project/_tests/Foo_Baz.test.brs');
    });

    it('finds base suite from split file (Foo_Bar.test.brs sees Foo.test.brs)', () => {
      readdirStub.returns(['Foo.test.brs', 'Foo_Bar.test.brs']);
      const result = findTestSiblings('/project/_tests/Foo_Bar.test.brs');
      expect(result).to.have.lengthOf(1);
      expect(result[0].replace(/\\/g, '/')).to.equal('/project/_tests/Foo.test.brs');
    });

    it('does not include itself', () => {
      readdirStub.returns(['Foo.test.brs', 'Foo_Bar.test.brs']);
      const result = findTestSiblings('/project/_tests/Foo.test.brs');
      expect(result.map((p: string) => p.replace(/\\/g, '/'))).to.not.include('/project/_tests/Foo.test.brs');
    });

    it('does not include unrelated test files', () => {
      readdirStub.returns(['Foo.test.brs', 'Bar.test.brs', 'Bar_Main.test.brs']);
      const result = findTestSiblings('/project/_tests/Foo.test.brs');
      expect(result).to.be.empty;
    });
  });
});
