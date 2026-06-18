import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { collectAllFunctions, collectFunctionsFromImports, collectFunctionsFromExtends } from '../../src/server/brightscript/functionIndex';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

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

  // Collectors now populate cross-test module caches (file parse cache +
  // component-XML resolution cache); reset them all between tests so reused
  // paths/component names don't return a prior test's result.
  afterEach(() => { sinon.restore(); invalidateAllCaches(); });

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

    it('reads each imported file only once across repeated collections (shared cache)', () => {
      const mainText = [
        "' @import /utils/helper.brs",
        'function main()',
        'end function',
      ].join('\n');
      existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
      readFileStub.withArgs('/project/app/utils/helper.brs', 'utf-8')
        .returns('function helperFn()\nend function');
      readdirStub.returns([]);

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      collectAllFunctions('/project/app/main.brs', mainText, resolver);
      collectAllFunctions('/project/app/main.brs', mainText, resolver);

      // The imported file is read from disk once; the second collection hits the
      // shared file parse cache instead of re-reading.
      const helperReads = readFileStub.getCalls()
        .filter((c) => c.args[0] === '/project/app/utils/helper.brs');
      expect(helperReads).to.have.length(1);
    });

    it('parses the entry file from the passed text, never the cache', () => {
      readdirStub.returns([]);
      const resolver = makeResolver();

      // Same entry path, different live text on each call — the result must
      // reflect the text passed in, proving the entry is never served from cache.
      const v1 = collectAllFunctions('/dir/entry.brs', 'function versionOne()\nend function', resolver);
      const v2 = collectAllFunctions('/dir/entry.brs', 'function versionTwo()\nend function', resolver);

      expect(v1.map((d) => d.name)).to.deep.equal(['versionOne']);
      expect(v2.map((d) => d.name)).to.deep.equal(['versionTwo']);
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
});
