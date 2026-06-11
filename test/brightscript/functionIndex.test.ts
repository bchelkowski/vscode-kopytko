import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { parseFunctionDefs, collectAllFunctions, collectFunctionsFromImports, collectFunctionsFromExtends } from '../../src/server/brightscript/functionIndex';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';

const makeResolver = (opts: Partial<ConstructorParameters<typeof KopytkoImportResolver>[0]> = {}) =>
  new KopytkoImportResolver({
    workspaceFolders: ['/project'],
    sourceDir: 'app',
    resolveModules: false,
    ...opts,
  });

describe('functionIndex', () => {
  let existsStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let readdirStub: sinon.SinonStub;
  let readdirTypedStub: sinon.SinonStub;

  beforeEach(() => {
    existsStub = sinon.stub(fsWrapper, 'existsSync');
    readFileStub = sinon.stub(fsWrapper, 'readFileSync');
    readdirStub = sinon.stub(fsWrapper, 'readdirSync');
    readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped');
  });

  afterEach(() => sinon.restore());

  // ── parseFunctionDefs ────────────────────────────────────────────────────

  describe('parseFunctionDefs', () => {
    it('parses a simple function definition', () => {
      const text = 'function myFunc()\n  return 1\nend function';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs).to.have.length(1);
      expect(defs[0].name).to.equal('myFunc');
      expect(defs[0].nameLower).to.equal('myfunc');
      expect(defs[0].line).to.equal(0);
      expect(defs[0].filePath).to.equal('/file.brs');
    });

    it('parses a sub definition', () => {
      const text = 'sub doThing()\nend sub';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].name).to.equal('doThing');
    });

    it('column points to start of function name', () => {
      const text = '  function myHelper()';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].column).to.equal(11); // "  function " = 11 chars
    });

    it('parses multiple definitions', () => {
      const text = [
        'function alpha()',
        '  return 1',
        'end function',
        '',
        'sub beta()',
        'end sub',
      ].join('\n');
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs.map((d) => d.name)).to.deep.equal(['alpha', 'beta']);
      expect(defs[1].line).to.equal(4);
    });

    it('is case-insensitive for function/sub keyword', () => {
      const text = 'Function CamelFunc()\nEnd Function';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].name).to.equal('CamelFunc');
    });

    it('captures the full declaration line as signature (trimmed)', () => {
      const text = '  function greet(name as String) as String\n  return ""\nend function';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].signature).to.equal('function greet(name as String) as String');
    });

    it('captures sub signature too', () => {
      const text = 'sub doWork(items as Object)\nend sub';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].signature).to.equal('sub doWork(items as Object)');
    });

    it('returns empty array for file with no definitions', () => {
      expect(parseFunctionDefs('x = 1\ny = 2', '/file.brs')).to.deep.equal([]);
    });

    it('does not parse anonymous functions (no name)', () => {
      const text = 'm.handler = function()\nend function';
      expect(parseFunctionDefs(text, '/file.brs')).to.deep.equal([]);
    });
  });

  // ── collectAllFunctions ──────────────────────────────────────────────────

  describe('collectAllFunctions', () => {
    it('collects functions from the current file', () => {
      readdirStub.returns([]);
      const text = 'function localFn()\nend function';
      const resolver = makeResolver();
      const defs = collectAllFunctions('/file.brs', text, resolver);
      expect(defs.map((d) => d.name)).to.include('localFn');
    });

    it('collects functions from @imported files', () => {
      const mainText = [
        "' @import /utils/helper.brs",
        'function main()',
        'end function',
      ].join('\n');
      const helperText = 'function helperFn()\nend function';

      existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
      readFileStub.withArgs('/project/app/utils/helper.brs', 'utf-8').returns(helperText);
      readdirStub.returns([]);

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      const defs = collectAllFunctions('/project/app/main.brs', mainText, resolver);
      const names = defs.map((d) => d.name);
      expect(names).to.include('main');
      expect(names).to.include('helperFn');
    });

    it('collects functions from XML sibling files', () => {
      const mainText = 'function mainFn()\nend function';
      const siblingText = 'function siblingFn()\nend function';

      readdirStub.withArgs('/dir').returns(['Component.xml']);
      readFileStub.withArgs('/dir/Component.xml', 'utf-8').returns(
        `<script type="text/brightscript" uri="main.brs" />
         <script type="text/brightscript" uri="sibling.brs" />`
      );
      existsStub.withArgs('/dir/main.brs').returns(true);
      existsStub.withArgs('/dir/sibling.brs').returns(true);
      readFileStub.withArgs('/dir/sibling.brs', 'utf-8').returns(siblingText);

      const resolver = makeResolver();
      const defs = collectAllFunctions('/dir/main.brs', mainText, resolver);
      const names = defs.map((d) => d.name);
      expect(names).to.include('mainFn');
      expect(names).to.include('siblingFn');
    });

    it('does not follow the same file twice (circular import guard)', () => {
      const text = "' @import /file.brs\nfunction fn()\nend function";
      existsStub.withArgs('/project/app/file.brs').returns(true);
      readFileStub.withArgs('/project/app/file.brs', 'utf-8').returns(text);
      readdirStub.returns([]);

      const resolver = makeResolver();
      // Should not throw or loop infinitely
      const defs = collectAllFunctions('/project/app/file.brs', text, resolver);
      expect(defs.filter((d) => d.name === 'fn')).to.have.length(1);
    });

    it('gracefully handles unresolved imports', () => {
      const text = "' @import /missing.brs\nfunction fn()\nend function";
      existsStub.returns(false);
      readdirStub.returns([]);

      const resolver = makeResolver();
      const defs = collectAllFunctions('/file.brs', text, resolver);
      expect(defs.map((d) => d.name)).to.deep.equal(['fn']);
    });

    it('assigns the correct filePath to each definition', () => {
      const mainText = "' @import /utils.brs\nfunction mainFn()\nend function";
      const utilsText = 'function utilFn()\nend function';

      existsStub.withArgs('/project/app/utils.brs').returns(true);
      readFileStub.withArgs('/project/app/utils.brs', 'utf-8').returns(utilsText);
      readdirStub.returns([]);

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      const defs = collectAllFunctions('/project/app/main.brs', mainText, resolver);
      const mainDef = defs.find((d) => d.name === 'mainFn');
      const utilDef = defs.find((d) => d.name === 'utilFn');
      expect(mainDef?.filePath).to.equal('/project/app/main.brs');
      expect(utilDef?.filePath).to.equal('/project/app/utils.brs');
    });

    it('collects functions from pattern-based sibling files', () => {
      const componentText = 'function componentFn()\nend function';
      const templateText = 'function templateFn()\nend function';

      readdirStub.returns([]);
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      readFileStub.withArgs('/dir/Foo.template.brs', 'utf-8').returns(templateText);

      const resolver = makeResolver();
      const siblingPatterns = [['*.component.brs', '*.template.brs']];
      const defs = collectAllFunctions('/dir/Foo.component.brs', componentText, resolver, new Set(), siblingPatterns);
      const names = defs.map((d) => d.name);
      expect(names).to.include('componentFn');
      expect(names).to.include('templateFn');
    });

    it('collects functions from sibling @import chain', () => {
      const componentText = 'function componentFn()\nend function';
      const templateText = "' @import /utils/helper.brs\nfunction templateFn()\nend function";
      const helperText = 'function helperFn()\nend function';

      readdirStub.returns([]);
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
      readFileStub.withArgs('/dir/Foo.template.brs', 'utf-8').returns(templateText);
      readFileStub.withArgs('/project/app/utils/helper.brs', 'utf-8').returns(helperText);

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      const siblingPatterns = [['*.component.brs', '*.template.brs']];
      const defs = collectAllFunctions('/dir/Foo.component.brs', componentText, resolver, new Set(), siblingPatterns);
      const names = defs.map((d) => d.name);
      expect(names).to.include('componentFn');
      expect(names).to.include('templateFn');
      expect(names).to.include('helperFn');
    });

    it('does not include sibling functions when siblingPatterns is empty', () => {
      const componentText = 'function componentFn()\nend function';
      const templateText = 'function templateFn()\nend function';

      readdirStub.returns([]);
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      readFileStub.withArgs('/dir/Foo.template.brs', 'utf-8').returns(templateText);

      const resolver = makeResolver();
      const defs = collectAllFunctions('/dir/Foo.component.brs', componentText, resolver);
      const names = defs.map((d) => d.name);
      expect(names).to.include('componentFn');
      expect(names).not.to.include('templateFn');
    });

    it('does not recurse infinitely when sibling patterns match both files', () => {
      const componentText = 'function componentFn()\nend function';
      const templateText = 'function templateFn()\nend function';

      readdirStub.returns([]);
      existsStub.withArgs('/dir/Foo.component.brs').returns(true);
      existsStub.withArgs('/dir/Foo.template.brs').returns(true);
      readFileStub.withArgs('/dir/Foo.component.brs', 'utf-8').returns(componentText);
      readFileStub.withArgs('/dir/Foo.template.brs', 'utf-8').returns(templateText);

      const resolver = makeResolver();
      const siblingPatterns = [['*.component.brs', '*.template.brs']];
      const defs = collectAllFunctions('/dir/Foo.component.brs', componentText, resolver, new Set(), siblingPatterns);
      const names = defs.map((d) => d.name);
      expect(names.filter((n) => n === 'componentFn')).to.have.length(1);
      expect(names).to.include('templateFn');
    });

    it('deduplicates functions found via both imports and extends chain in test files', () => {
      const testText = "function testSomething()\nend function";
      const sourceText = "' @import /utils/helper.brs\nfunction init()\nend function";
      const helperText = 'function helperFn()\nend function';

      // Source file exists and imports helper
      existsStub.returns(false);
      existsStub.withArgs('/project/app/Source.brs').returns(true);
      existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
      existsStub.withArgs('/project/app/Parent.xml').returns(true);
      readFileStub.withArgs('/project/app/Source.brs', 'utf-8').returns(sourceText);
      readFileStub.withArgs('/project/app/utils/helper.brs', 'utf-8').returns(helperText);

      // Source.xml extends Parent, Parent.xml lists helper.brs too
      readdirStub.returns([]);
      readdirStub.withArgs('/project/app').returns(['Source.xml']);
      readFileStub.withArgs('/project/app/Source.xml', 'utf-8').returns(
        '<component name="Source" extends="Parent"><script type="text/brightscript" uri="Source.brs" /></component>'
      );
      readFileStub.withArgs('/project/app/Parent.xml', 'utf-8').returns(
        '<component name="Parent"><script type="text/brightscript" uri="utils/helper.brs" /></component>'
      );

      // readdirTyped for findComponentXml tree walk
      readdirTypedStub.returns([]);
      readdirTypedStub.withArgs('/project/app').returns([
        { name: 'Parent.xml', isDirectory: false },
        { name: 'Source.xml', isDirectory: false },
        { name: 'utils', isDirectory: true },
      ]);

      const resolver = makeResolver();
      const defs = collectAllFunctions('/project/app/_tests/Source.test.brs', testText, resolver);
      const helperDefs = defs.filter((d) => d.name === 'helperFn');
      expect(helperDefs).to.have.length(1);
    });
  });

  // ── collectFunctionsFromImports ──────────────────────────────────────────

  describe('collectFunctionsFromImports', () => {
    it('collects functions from the current file', () => {
      readdirStub.returns([]);
      const text = 'function localFn()\nend function';
      const resolver = makeResolver();
      const defs = collectFunctionsFromImports('/file.brs', text, resolver);
      expect(defs.map((d) => d.name)).to.include('localFn');
    });

    it('collects functions from @imported files (transitively)', () => {
      const mainText = ["' @import /utils.brs", 'function main()', 'end function'].join('\n');
      const utilsText = 'function utilFn()\nend function';

      existsStub.withArgs('/project/app/utils.brs').returns(true);
      readFileStub.withArgs('/project/app/utils.brs', 'utf-8').returns(utilsText);

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      const defs = collectFunctionsFromImports('/project/app/main.brs', mainText, resolver);
      const names = defs.map((d) => d.name);
      expect(names).to.include('main');
      expect(names).to.include('utilFn');
    });

    it('does NOT collect functions from XML sibling files', () => {
      const mainText = 'function mainFn()\nend function';
      const siblingText = 'function siblingFn()\nend function';

      readdirStub.withArgs('/dir').returns(['Component.xml']);
      readFileStub.withArgs('/dir/Component.xml', 'utf-8').returns(
        `<script type="text/brightscript" uri="main.brs" />
         <script type="text/brightscript" uri="sibling.brs" />`
      );
      existsStub.withArgs('/dir/main.brs').returns(true);
      existsStub.withArgs('/dir/sibling.brs').returns(true);
      readFileStub.withArgs('/dir/sibling.brs', 'utf-8').returns(siblingText);

      const resolver = makeResolver();
      const defs = collectFunctionsFromImports('/dir/main.brs', mainText, resolver);
      const names = defs.map((d) => d.name);
      expect(names).to.include('mainFn');
      expect(names).not.to.include('siblingFn');
    });

    it('does not follow the same file twice (circular import guard)', () => {
      const text = "' @import /file.brs\nfunction fn()\nend function";
      existsStub.withArgs('/project/app/file.brs').returns(true);
      readFileStub.withArgs('/project/app/file.brs', 'utf-8').returns(text);
      readdirStub.returns([]);

      const resolver = makeResolver();
      const defs = collectFunctionsFromImports('/project/app/file.brs', text, resolver);
      expect(defs.filter((d) => d.name === 'fn')).to.have.length(1);
    });
  });

  // ── collectFunctionsFromExtends ──────────────────────────────────────────

  describe('collectFunctionsFromExtends', () => {
    it('returns functions defined in a parent component BRS file', () => {
      // Child XML in /dir lists child.brs and extends KopytkoGroup
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(
        `<component name="MyComp" extends="KopytkoGroup">
           <script type="text/brightscript" uri="child.brs" />
         </component>`
      );
      existsStub.withArgs('/dir/child.brs').returns(true);

      // findComponentXml search: workspace root/app + workspace root
      readdirTypedStub.withArgs('/project/app').returns([
        { name: 'KopytkoGroup.xml', isDirectory: false },
      ]);
      readFileStub.withArgs('/project/app/KopytkoGroup.xml', 'utf-8').returns(
        `<component name="KopytkoGroup">
           <script type="text/brightscript" uri="KopytkoGroup.brs" />
         </component>`
      );
      existsStub.withArgs('/project/app/KopytkoGroup.brs').returns(true);
      readFileStub.withArgs('/project/app/KopytkoGroup.brs', 'utf-8').returns(
        'function setState()\nend function\nfunction getState()\nend function'
      );

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      const defs = collectFunctionsFromExtends('/dir/child.brs', resolver);
      const names = defs.map((d) => d.name);
      expect(names).to.include('setState');
      expect(names).to.include('getState');
    });

    it('returns empty array when child XML has no extends attribute', () => {
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(
        `<component name="MyComp">
           <script type="text/brightscript" uri="child.brs" />
         </component>`
      );
      existsStub.withArgs('/dir/child.brs').returns(true);

      const resolver = makeResolver();
      const defs = collectFunctionsFromExtends('/dir/child.brs', resolver);
      expect(defs).to.deep.equal([]);
    });

    it('returns empty array when parent component XML cannot be found', () => {
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(
        `<component name="MyComp" extends="MissingParent">
           <script type="text/brightscript" uri="child.brs" />
         </component>`
      );
      existsStub.withArgs('/dir/child.brs').returns(true);
      readdirTypedStub.returns([]);

      const resolver = makeResolver();
      const defs = collectFunctionsFromExtends('/dir/child.brs', resolver);
      expect(defs).to.deep.equal([]);
    });

    it('follows extends chain transitively (grandparent)', () => {
      readdirStub.withArgs('/dir').returns(['Child.xml']);
      readFileStub.withArgs('/dir/Child.xml', 'utf-8').returns(
        `<component name="Child" extends="Parent">
           <script type="text/brightscript" uri="child.brs" />
         </component>`
      );
      existsStub.withArgs('/dir/child.brs').returns(true);

      // Parent XML in /project/app
      readdirTypedStub.withArgs('/project/app').returns([
        { name: 'Parent.xml', isDirectory: false },
      ]);
      readFileStub.withArgs('/project/app/Parent.xml', 'utf-8').returns(
        `<component name="Parent" extends="GrandParent">
           <script type="text/brightscript" uri="parent.brs" />
         </component>`
      );
      existsStub.withArgs('/project/app/parent.brs').returns(true);
      readFileStub.withArgs('/project/app/parent.brs', 'utf-8').returns(
        'function parentFn()\nend function'
      );

      // GrandParent XML also in /project/app
      readdirTypedStub.withArgs('/project/app').returns([
        { name: 'Parent.xml', isDirectory: false },
        { name: 'GrandParent.xml', isDirectory: false },
      ]);
      readFileStub.withArgs('/project/app/GrandParent.xml', 'utf-8').returns(
        `<component name="GrandParent">
           <script type="text/brightscript" uri="grandparent.brs" />
         </component>`
      );
      existsStub.withArgs('/project/app/grandparent.brs').returns(true);
      readFileStub.withArgs('/project/app/grandparent.brs', 'utf-8').returns(
        'function grandFn()\nend function'
      );

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      const defs = collectFunctionsFromExtends('/dir/child.brs', resolver);
      const names = defs.map((d) => d.name);
      expect(names).to.include('parentFn');
      expect(names).to.include('grandFn');
    });

    it('returns empty array when brs file is not listed in any XML', () => {
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(
        `<component name="MyComp" extends="KopytkoGroup">
           <script type="text/brightscript" uri="other.brs" />
         </component>`
      );
      // /dir/child.brs is not listed in MyComp.xml
      existsStub.withArgs('/dir/child.brs').returns(false);
      existsStub.withArgs('/dir/other.brs').returns(true);

      const resolver = makeResolver();
      const defs = collectFunctionsFromExtends('/dir/child.brs', resolver);
      expect(defs).to.deep.equal([]);
    });
  });

  // ── resolveTestedFiles ─────────────────────────────────────────────────────

  describe('resolveTestedFiles', () => {
    let resolveTestedFiles: typeof import('../../src/server/brightscript/functionIndex').resolveTestedFiles;

    before(() => {
      resolveTestedFiles = require('../../src/server/brightscript/functionIndex').resolveTestedFiles;
    });

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

    it('resolves nested _tests subdirectory (RailsService/RailsService_fetch.test.brs)', () => {
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

    it('resolves split suite with PascalCase-suffix (SomeServiceService_fetch.test.brs → SomeService.service.brs)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/SomeService.service.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/SomeServiceService_fetch.test.brs');
      expect(result).to.include('/project/app/components/SomeService.service.brs');
    });

    it('resolves PascalCase-suffix test (FooComponent.test.brs → Foo.component.brs)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/Foo.component.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/FooComponent.test.brs');
      expect(result).to.include('/project/app/components/Foo.component.brs');
    });

    it('still resolves exact match when no suffix split applies (FooService.test.brs → FooService.brs)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/FooService.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/FooService.test.brs');
      expect(result).to.include('/project/app/components/FooService.brs');
    });

    it('resolves any arbitrary suffix (SomeFooWidget.test.brs → SomeFoo.widget.brs)', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/SomeFoo.widget.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/SomeFooWidget.test.brs');
      expect(result).to.include('/project/app/components/SomeFoo.widget.brs');
    });

    it('resolves multi-word suffix: SomeFooBarBaz.test.brs → SomeFooBar.baz.brs', () => {
      existsStub.callsFake((p: string) => p === '/project/app/components/SomeFooBar.baz.brs');
      const result = resolveTestedFiles('/project/app/components/_tests/SomeFooBarBaz.test.brs');
      expect(result).to.include('/project/app/components/SomeFooBar.baz.brs');
    });
  });

  // ── findTestSiblings ────────────────────────────────────────────────────────

  describe('findTestSiblings', () => {
    let findTestSiblings: typeof import('../../src/server/brightscript/functionIndex').findTestSiblings;

    before(() => {
      findTestSiblings = require('../../src/server/brightscript/functionIndex').findTestSiblings;
    });

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
