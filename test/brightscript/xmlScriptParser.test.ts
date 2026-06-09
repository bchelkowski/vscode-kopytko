import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import {
  parseXmlScriptUris,
  resolveScriptUri,
  getScriptPathsFromXml,
  findParentXmls,
  getXmlSiblingPaths,
  parseXmlExtends,
  findComponentXml,
  parseXmlInterface,
} from '../../src/server/brightscript/xmlScriptParser';

describe('xmlScriptParser', () => {
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

  // ── parseXmlScriptUris ───────────────────────────────────────────────────

  describe('parseXmlScriptUris', () => {
    it('extracts uri values from script tags', () => {
      const xml = `
        <component name="Foo">
          <script type="text/brightscript" uri="App.routing.brs" />
          <script type="text/brightscript" uri="App.template.brs" />
          <script type="text/brightscript" uri="App.view.brs" />
        </component>`;
      expect(parseXmlScriptUris(xml)).to.deep.equal([
        'App.routing.brs',
        'App.template.brs',
        'App.view.brs',
      ]);
    });

    it('extracts pkg:/ URIs', () => {
      const xml = `<script type="text/brightscript" uri="pkg:/components/utils.brs" />`;
      expect(parseXmlScriptUris(xml)).to.deep.equal(['pkg:/components/utils.brs']);
    });

    it('handles uri= before type=', () => {
      const xml = `<script uri="helper.brs" type="text/brightscript" />`;
      expect(parseXmlScriptUris(xml)).to.deep.equal(['helper.brs']);
    });

    it('returns empty array when no script tags', () => {
      expect(parseXmlScriptUris('<component />')).to.deep.equal([]);
    });

    it('ignores non-brightscript script tags', () => {
      const xml = `<script uri="style.css" />`;
      expect(parseXmlScriptUris(xml)).to.deep.equal(['style.css']);
    });
  });

  // ── resolveScriptUri ─────────────────────────────────────────────────────

  describe('resolveScriptUri', () => {
    it('resolves a relative URI against the XML directory', () => {
      existsStub.withArgs('/project/app/components/App.routing.brs').returns(true);
      const result = resolveScriptUri(
        'App.routing.brs',
        '/project/app/components',
        ['/project'],
        'app'
      );
      expect(result).to.equal('/project/app/components/App.routing.brs');
    });

    it('returns undefined when relative file does not exist', () => {
      existsStub.returns(false);
      const result = resolveScriptUri('missing.brs', '/dir', ['/project'], 'app');
      expect(result).to.be.undefined;
    });

    it('resolves pkg:/ URI via workspace + sourceDir', () => {
      existsStub.withArgs('/project/app/components/utils.brs').returns(true);
      const result = resolveScriptUri(
        'pkg:/components/utils.brs',
        '/project/app/components',
        ['/project'],
        'app'
      );
      expect(result).to.equal('/project/app/components/utils.brs');
    });

    it('resolves pkg:/ URI via workspace root when sourceDir path not found', () => {
      existsStub.withArgs('/project/app/components/utils.brs').returns(false);
      existsStub.withArgs('/project/components/utils.brs').returns(true);
      const result = resolveScriptUri(
        'pkg:/components/utils.brs',
        '/project/app/components',
        ['/project'],
        'app'
      );
      expect(result).to.equal('/project/components/utils.brs');
    });

    it('returns undefined when pkg:/ URI cannot be resolved', () => {
      existsStub.returns(false);
      const result = resolveScriptUri(
        'pkg:/missing.brs',
        '/dir',
        ['/project'],
        'app'
      );
      expect(result).to.be.undefined;
    });
  });

  // ── getScriptPathsFromXml ────────────────────────────────────────────────

  describe('getScriptPathsFromXml', () => {
    it('returns resolved paths from XML script tags', () => {
      readFileStub.withArgs('/project/app/components/App.view.xml', 'utf-8').returns(`
        <component name="AppView">
          <script type="text/brightscript" uri="App.routing.brs" />
          <script type="text/brightscript" uri="App.view.brs" />
        </component>`);
      existsStub.withArgs('/project/app/components/App.routing.brs').returns(true);
      existsStub.withArgs('/project/app/components/App.view.brs').returns(true);

      const result = getScriptPathsFromXml(
        '/project/app/components/App.view.xml',
        ['/project'],
        'app'
      );
      expect(result).to.include.members([
        '/project/app/components/App.routing.brs',
        '/project/app/components/App.view.brs',
      ]);
    });

    it('skips URIs that cannot be resolved', () => {
      readFileStub.returns(`<script type="text/brightscript" uri="missing.brs" />`);
      existsStub.returns(false);
      expect(getScriptPathsFromXml('/dir/Component.xml', ['/project'], 'app')).to.deep.equal([]);
    });

    it('returns empty array when XML file cannot be read', () => {
      readFileStub.throws(new Error('ENOENT'));
      expect(getScriptPathsFromXml('/dir/Component.xml', ['/project'], 'app')).to.deep.equal([]);
    });
  });

  // ── findParentXmls ────────────────────────────────────────────────────────

  describe('findParentXmls', () => {
    it('finds XML files in same directory that reference the brs file', () => {
      readdirStub.returns(['App.view.xml', 'Other.xml', 'App.view.brs']);
      readFileStub.withArgs('/dir/App.view.xml', 'utf-8').returns(
        `<script uri="App.routing.brs" />`
      );
      readFileStub.withArgs('/dir/Other.xml', 'utf-8').returns('<component />');

      const result = findParentXmls('/dir/App.routing.brs');
      expect(result).to.deep.equal(['/dir/App.view.xml']);
    });

    it('returns empty array when no XML references the file', () => {
      readdirStub.returns(['Unrelated.xml']);
      readFileStub.returns('<component />');
      expect(findParentXmls('/dir/App.routing.brs')).to.deep.equal([]);
    });

    it('returns empty array when directory cannot be read', () => {
      readdirStub.throws(new Error('ENOENT'));
      expect(findParentXmls('/dir/file.brs')).to.deep.equal([]);
    });
  });

  // ── parseXmlInterface ─────────────────────────────────────────────────────

  describe('parseXmlInterface', () => {
    it('extracts field declarations', () => {
      const xml = `<component name="X">
        <interface>
          <field id="items" type="array" value="[]" />
          <field id="selected" type="assocarray" />
        </interface>
      </component>`;
      const result = parseXmlInterface(xml);
      expect(result.fields).to.have.length(2);
      expect(result.fields[0]).to.deep.equal({ name: 'items', type: 'array' });
      expect(result.fields[1]).to.deep.equal({ name: 'selected', type: 'assocarray' });
    });

    it('extracts function declarations', () => {
      const xml = `<component name="X">
        <interface>
          <function name="setState" />
          <function name="getState" />
        </interface>
      </component>`;
      const result = parseXmlInterface(xml);
      expect(result.functions).to.have.length(2);
      expect(result.functions.map((f) => f.name)).to.deep.equal(['setState', 'getState']);
    });

    it('defaults type to dynamic when no type attribute', () => {
      const xml = `<component name="X">
        <interface><field id="data" /></interface>
      </component>`;
      const result = parseXmlInterface(xml);
      expect(result.fields[0].type).to.equal('dynamic');
    });

    it('returns empty arrays when no interface section', () => {
      const result = parseXmlInterface('<component name="X"></component>');
      expect(result.fields).to.deep.equal([]);
      expect(result.functions).to.deep.equal([]);
    });

    it('handles mixed fields and functions', () => {
      const xml = `<component name="X">
        <interface>
          <field id="count" type="integer" />
          <function name="increment" />
        </interface>
      </component>`;
      const result = parseXmlInterface(xml);
      expect(result.fields).to.have.length(1);
      expect(result.functions).to.have.length(1);
    });
  });

  // ── parseXmlExtends ───────────────────────────────────────────────────────

  describe('parseXmlExtends', () => {
    it('returns the extends value from a component tag', () => {
      expect(parseXmlExtends(`<component name="MyComp" extends="KopytkoGroup">`))
        .to.equal('KopytkoGroup');
    });

    it('handles single-quoted attribute', () => {
      expect(parseXmlExtends(`<component extends='BaseComp' name="X">`))
        .to.equal('BaseComp');
    });

    it('returns null when no extends attribute', () => {
      expect(parseXmlExtends(`<component name="MyComp">`)).to.be.null;
    });

    it('returns null for empty string', () => {
      expect(parseXmlExtends('')).to.be.null;
    });
  });

  // ── findComponentXml ──────────────────────────────────────────────────────

  describe('findComponentXml', () => {
    it('finds a matching XML file in the search root', () => {
      readdirTypedStub.withArgs('/project/components').returns([
        { name: 'KopytkoGroup.xml', isDirectory: false },
        { name: 'Other.xml', isDirectory: false },
      ]);
      const result = findComponentXml('KopytkoGroup', ['/project/components']);
      expect(result).to.equal('/project/components/KopytkoGroup.xml');
    });

    it('recurses into subdirectories to find the file', () => {
      readdirTypedStub.withArgs('/project/src').returns([
        { name: 'sub', isDirectory: true },
      ]);
      readdirTypedStub.withArgs('/project/src/sub').returns([
        { name: 'KopytkoGroup.xml', isDirectory: false },
      ]);
      const result = findComponentXml('KopytkoGroup', ['/project/src']);
      expect(result).to.equal('/project/src/sub/KopytkoGroup.xml');
    });

    it('skips node_modules and dot directories', () => {
      readdirTypedStub.withArgs('/project/src').returns([
        { name: 'node_modules', isDirectory: true },
        { name: '.hidden', isDirectory: true },
      ]);
      // Neither subdirectory should be descended into
      const result = findComponentXml('KopytkoGroup', ['/project/src']);
      expect(result).to.be.undefined;
    });

    it('returns undefined when not found in any root', () => {
      readdirTypedStub.returns([]);
      expect(findComponentXml('Missing', ['/project/a', '/project/b'])).to.be.undefined;
    });

    it('returns undefined when directory read throws', () => {
      readdirTypedStub.throws(new Error('ENOENT'));
      expect(findComponentXml('Foo', ['/nonexistent'])).to.be.undefined;
    });

    it('returns undefined when depth limit is exceeded', () => {
      // Create a stub that always returns one directory entry (infinite tree)
      readdirTypedStub.returns([{ name: 'deep', isDirectory: true }]);
      expect(findComponentXml('Foo', ['/project'], 0)).to.be.undefined;
    });

    it('finds XML by component name attribute when filename differs', () => {
      readdirTypedStub.withArgs('/project/components').returns([
        { name: 'RokuStore.request.xml', isDirectory: false },
      ]);
      readFileStub.withArgs('/project/components/RokuStore.request.xml', 'utf-8').returns(
        '<component name="RokuStoreRequest" extends="BaseRequest">\n' +
        '  <script type="text/brightscript" uri="RokuStore.request.brs"/>\n' +
        '</component>'
      );
      const result = findComponentXml('RokuStoreRequest', ['/project/components']);
      expect(result).to.equal('/project/components/RokuStore.request.xml');
    });
  });

  // ── getXmlSiblingPaths ────────────────────────────────────────────────────

  describe('getXmlSiblingPaths', () => {
    it('returns sibling brs paths from shared XML, excluding self', () => {
      readdirStub.returns(['App.view.xml']);
      readFileStub.withArgs('/dir/App.view.xml', 'utf-8').returns(`
        <script type="text/brightscript" uri="App.routing.brs" />
        <script type="text/brightscript" uri="App.template.brs" />
        <script type="text/brightscript" uri="App.view.brs" />`);
      existsStub.callsFake((p: string) =>
        ['/dir/App.routing.brs', '/dir/App.template.brs', '/dir/App.view.brs'].includes(p)
      );

      const result = getXmlSiblingPaths('/dir/App.routing.brs', ['/project'], 'app');
      expect(result).to.include.members(['/dir/App.template.brs', '/dir/App.view.brs']);
      expect(result).not.to.include('/dir/App.routing.brs');
    });

    it('returns empty array when no parent XML found', () => {
      readdirStub.returns([]);
      expect(getXmlSiblingPaths('/dir/file.brs', ['/project'], 'app')).to.deep.equal([]);
    });
  });
});
