import { expect } from 'chai';
import * as sinon from 'sinon';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { collectMtopItems } from '../../src/server/brightscript/mtopResolver';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

const makeResolver = (opts: Partial<ConstructorParameters<typeof KopytkoImportResolver>[0]> = {}) =>
  new KopytkoImportResolver({
    workspaceFolders: ['/project'],
    sourceDir: 'app',
    resolveModules: false,
    ...opts,
  });

describe('mtopResolver', () => {
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

  // collectMtopItems reads XML via the shared file parse cache and resolves
  // components via the component-XML cache; reset both between tests.
  afterEach(() => { sinon.restore(); invalidateAllCaches(); });

  describe('collectMtopItems', () => {
    it('returns empty when no XML file in the same directory', () => {
      readdirStub.returns([]);
      const result = collectMtopItems('/dir/MyComp.brs', makeResolver());
      expect(result.fields).to.deep.equal([]);
      expect(result.methods).to.deep.equal([]);
    });

    it('returns fields declared in the component XML interface', () => {
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(`
        <component name="MyComp" extends="Node">
          <interface>
            <field id="items" type="array" />
            <field id="selectedIndex" type="integer" />
          </interface>
          <script type="text/brightscript" uri="MyComp.brs" />
        </component>`);
      existsStub.withArgs('/dir/MyComp.brs').returns(true);
      readdirTypedStub.returns([]);

      const result = collectMtopItems('/dir/MyComp.brs', makeResolver());
      const names = result.fields.map((f) => f.name);
      expect(names).to.include('items');
      expect(names).to.include('selectedIndex');
    });

    it('returns function declarations from the component XML interface', () => {
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(`
        <component name="MyComp" extends="Node">
          <interface>
            <function name="setState" />
          </interface>
          <script type="text/brightscript" uri="MyComp.brs" />
        </component>`);
      existsStub.withArgs('/dir/MyComp.brs').returns(true);
      readdirTypedStub.returns([]);

      const result = collectMtopItems('/dir/MyComp.brs', makeResolver());
      expect(result.fields.map((f) => f.name)).to.include('setState');
    });

    it('includes Node fields when the component extends Node directly', () => {
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(`
        <component name="MyComp" extends="Node">
          <interface><field id="count" type="integer" /></interface>
          <script type="text/brightscript" uri="MyComp.brs" />
        </component>`);
      existsStub.withArgs('/dir/MyComp.brs').returns(true);
      readdirTypedStub.returns([]);

      const result = collectMtopItems('/dir/MyComp.brs', makeResolver());
      const fieldNames = result.fields.map((f) => f.name);
      const methodNames = result.methods.map((m) => m.name);
      expect(fieldNames).to.include('id');
      expect(fieldNames).to.include('focusable');
      expect(methodNames).to.include('observeFieldScoped');
      expect(methodNames).to.include('findNode');
    });

    it('includes Group fields when the component extends Group', () => {
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(`
        <component name="MyComp" extends="Group">
          <interface />
          <script type="text/brightscript" uri="MyComp.brs" />
        </component>`);
      existsStub.withArgs('/dir/MyComp.brs').returns(true);
      readdirTypedStub.returns([]);

      const result = collectMtopItems('/dir/MyComp.brs', makeResolver());
      const fieldNames = result.fields.map((f) => f.name);
      expect(fieldNames).to.include('visible');
      expect(fieldNames).to.include('opacity');
      expect(fieldNames).to.include('translation');
      // inherited from Node
      expect(fieldNames).to.include('id');
    });

    it('traverses user-defined extends chain to reach native catalog', () => {
      // MyComp extends KopytkoGroup (user XML), KopytkoGroup extends Group (native)
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(`
        <component name="MyComp" extends="KopytkoGroup">
          <interface><field id="state" type="assocarray" /></interface>
          <script type="text/brightscript" uri="MyComp.brs" />
        </component>`);
      existsStub.withArgs('/dir/MyComp.brs').returns(true);

      // findComponentXml searches /project/app first
      readdirTypedStub.withArgs('/project/app').returns([
        { name: 'KopytkoGroup.xml', isDirectory: false },
      ]);
      readdirTypedStub.returns([]);
      readFileStub.withArgs('/project/app/KopytkoGroup.xml', 'utf-8').returns(`
        <component name="KopytkoGroup" extends="Group">
          <interface><field id="kopytkoField" type="string" /></interface>
        </component>`);

      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });
      const result = collectMtopItems('/dir/MyComp.brs', resolver);
      const fieldNames = result.fields.map((f) => f.name);

      expect(fieldNames).to.include('state');        // own field
      expect(fieldNames).to.include('kopytkoField'); // parent field
      expect(fieldNames).to.include('visible');      // Group (native) field
      expect(fieldNames).to.include('id');           // Node (native, transitive) field
      expect(result.methods.map((m) => m.name)).to.include('observeFieldScoped');
    });

    it('returns empty when the brs file is not listed in any XML', () => {
      readdirStub.withArgs('/dir').returns(['MyComp.xml']);
      readFileStub.withArgs('/dir/MyComp.xml', 'utf-8').returns(`
        <component name="MyComp">
          <script type="text/brightscript" uri="other.brs" />
        </component>`);
      existsStub.withArgs('/dir/other.brs').returns(true);
      existsStub.withArgs('/dir/MyComp.brs').returns(false);

      const result = collectMtopItems('/dir/MyComp.brs', makeResolver());
      expect(result.fields).to.deep.equal([]);
    });

    it('returns empty when the directory cannot be read', () => {
      readdirStub.throws(new Error('ENOENT'));
      const result = collectMtopItems('/dir/MyComp.brs', makeResolver());
      expect(result.fields).to.deep.equal([]);
      expect(result.methods).to.deep.equal([]);
    });

    it('matches brs path when XML uses a pkg:/ URI resolved against the workspace', () => {
      // The XML lists the script as pkg:/components/MyComp/MyComp.brs and the
      // brs path is the resolved absolute path — these must match even if one
      // uses forward slashes and the other comes from path.join.
      const resolver = makeResolver({ workspaceFolders: ['/project'], sourceDir: 'app' });

      readdirStub.withArgs('/project/app/components/MyComp').returns(['MyComp.xml']);
      readFileStub.withArgs('/project/app/components/MyComp/MyComp.xml', 'utf-8').returns(`
        <component name="MyComp" extends="Node">
          <interface>
            <field id="visible" type="boolean" />
          </interface>
          <script type="text/brightscript" uri="pkg:/components/MyComp/MyComp.brs" />
        </component>`);
      existsStub.withArgs('/project/app/components/MyComp/MyComp.brs').returns(true);
      readdirTypedStub.returns([]);

      const result = collectMtopItems(
        '/project/app/components/MyComp/MyComp.brs',
        resolver,
      );
      expect(result.fields.map((f) => f.name)).to.include('visible');
    });
  });
});
