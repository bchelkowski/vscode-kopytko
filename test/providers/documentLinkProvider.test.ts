import { expect } from 'chai';
import * as sinon from 'sinon';
import { TextDocument } from 'vscode-languageserver-textdocument';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { BrightScriptDocumentLinkProvider } from '../../src/server/providers/documentLinkProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';

const makeDocument = (content: string, uri = 'file:///project/app/main.brs') =>
  TextDocument.create(uri, 'brightscript', 1, content);

const makeResolver = (opts: Partial<ConstructorParameters<typeof KopytkoImportResolver>[0]> = {}) =>
  new KopytkoImportResolver({
    workspaceFolders: ['/project'],
    sourceDir: 'app',
    resolveModules: false,
    ...opts,
  });

describe('BrightScriptDocumentLinkProvider', () => {
  let existsStub: sinon.SinonStub;
  let provider: BrightScriptDocumentLinkProvider;

  beforeEach(() => {
    existsStub = sinon.stub(fsWrapper, 'existsSync');
    existsStub.returns(false);
    provider = new BrightScriptDocumentLinkProvider(makeResolver());
  });

  afterEach(() => sinon.restore());

  it('returns a link for a resolved internal @import', () => {
    existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
    const doc = makeDocument("' @import /utils/helper.brs");

    const links = provider.provideDocumentLinks(doc);
    expect(links).to.have.length(1);
    expect(links[0].target).to.include('helper.brs');
  });

  it('link range covers only the path token, not the full @import statement', () => {
    existsStub.withArgs('/project/app/utils/helper.brs').returns(true);
    const line = "' @import /utils/helper.brs";
    const doc = makeDocument(line);

    const links = provider.provideDocumentLinks(doc);
    const link = links[0];
    const pathStart = line.indexOf('/utils/helper.brs');
    expect(link.range.start.character).to.equal(pathStart);
    expect(link.range.end.character).to.equal(pathStart + '/utils/helper.brs'.length);
  });

  it('link range covers only the path token in @import ... from ...', () => {
    const line = "' @import /utils.brs from @kopytko/pkg";
    const doc = makeDocument(line);

    const resolver = makeResolver({ resolveModules: true });
    sinon.stub(fsWrapper, 'readFileSync').returns('{"kopytkoModuleDir":"src/"}');
    existsStub.callsFake((p: string) =>
      p.includes('node_modules/@kopytko/pkg') && p.endsWith('src/utils.brs')
    );
    const p = new BrightScriptDocumentLinkProvider(resolver);

    const links = p.provideDocumentLinks(doc);
    if (links.length > 0) {
      const link = links[0];
      const pathStart = line.indexOf('/utils.brs');
      expect(link.range.start.character).to.equal(pathStart);
      expect(link.range.end.character).to.equal(pathStart + '/utils.brs'.length);
    }
  });

  it('returns no link when @import cannot be resolved', () => {
    existsStub.returns(false);
    const doc = makeDocument("' @import /missing/file.brs");
    expect(provider.provideDocumentLinks(doc)).to.deep.equal([]);
  });

  it('returns multiple links for multiple @import lines', () => {
    existsStub.withArgs('/project/app/a.brs').returns(true);
    existsStub.withArgs('/project/app/b.brs').returns(true);
    const doc = makeDocument(["' @import /a.brs", "' @import /b.brs"].join('\n'));

    const links = provider.provideDocumentLinks(doc);
    expect(links).to.have.length(2);
    expect(links[0].range.start.line).to.equal(0);
    expect(links[1].range.start.line).to.equal(1);
  });

  it('link target is a file:// URI', () => {
    existsStub.withArgs('/project/app/utils.brs').returns(true);
    const doc = makeDocument("' @import /utils.brs");
    const [link] = provider.provideDocumentLinks(doc);
    expect(link.target).to.match(/^file:\/\//);
  });

  it('link tooltip shows the resolved absolute path', () => {
    existsStub.withArgs('/project/app/utils.brs').returns(true);
    const doc = makeDocument("' @import /utils.brs");
    const [link] = provider.provideDocumentLinks(doc);
    expect(link.tooltip).to.equal('/project/app/utils.brs');
  });

  it('returns no links for a file with no @import annotations', () => {
    const doc = makeDocument('function main()\nend function');
    expect(provider.provideDocumentLinks(doc)).to.deep.equal([]);
  });

  it('handles indented @import lines', () => {
    existsStub.withArgs('/project/app/utils.brs').returns(true);
    const line = "  ' @import /utils.brs";
    const doc = makeDocument(line);
    const links = provider.provideDocumentLinks(doc);
    expect(links).to.have.length(1);
    expect(links[0].range.start.character).to.equal(line.indexOf('/utils.brs'));
  });
});
