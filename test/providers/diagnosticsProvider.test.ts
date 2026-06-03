import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fsWrapper from '../../src/server/utils/fsWrapper';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { BrightScriptDiagnosticsProvider } from '../../src/server/providers/diagnosticsProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';

function makeDocument(content: string, uri = 'file:///workspace/app/components/Test.brs'): TextDocument {
  return TextDocument.create(uri, 'brightscript', 1, content);
}

describe('BrightScriptDiagnosticsProvider', () => {
  let fsExistsStub: sinon.SinonStub;
  let resolver: KopytkoImportResolver;
  let provider: BrightScriptDiagnosticsProvider;

  beforeEach(() => {
    fsExistsStub = sinon.stub(fsWrapper, 'existsSync').returns(false);
    resolver = new KopytkoImportResolver({
      workspaceFolders: ['/workspace'],
      sourceDir: 'app',
      resolveModules: true,
    });
    provider = new BrightScriptDiagnosticsProvider(resolver);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('returns no diagnostics for a file with no @import annotations', async () => {
    const doc = makeDocument(`sub init()\n  print "hello"\nend sub`);
    const diags = await provider.provideDiagnostics(doc);
    expect(diags).to.be.empty;
  });

  it('produces a warning for an unresolved internal import', async () => {
    fsExistsStub.returns(false);
    const doc = makeDocument(`' @import /components/missing.brs\nsub init()\nend sub`);
    const diags = await provider.provideDiagnostics(doc);

    expect(diags).to.have.length(1);
    expect(diags[0].severity).to.equal(DiagnosticSeverity.Warning);
    expect(diags[0].code).to.equal('import/unresolved');
  });

  it('produces a warning for an unresolved external import', async () => {
    fsExistsStub.returns(false);
    const doc = makeDocument(
      `' @import /components/KopytkoFramework.brs from @dazn/kopytko-framework\nsub init()\nend sub`
    );
    const diags = await provider.provideDiagnostics(doc);

    const unresolved = diags.find((d) => d.code === 'import/unresolved');
    expect(unresolved).to.not.be.undefined;
    expect(unresolved!.message).to.include('@dazn/kopytko-framework');
  });

  it('produces no diagnostics when import resolves successfully', async () => {
    fsExistsStub.withArgs(sinon.match('/workspace/app/components/utils.brs')).returns(true);

    const doc = makeDocument(`' @import /components/utils.brs\nsub init()\nend sub`);
    const diags = await provider.provideDiagnostics(doc);

    const unresolved = diags.filter((d) => d.code === 'import/unresolved');
    expect(unresolved).to.be.empty;
  });

  it('warns about import paths not starting with /', async () => {
    const doc = makeDocument(`' @import components/utils.brs\nsub init()\nend sub`);
    const diags = await provider.provideDiagnostics(doc);

    const pathWarning = diags.find((d) => d.code === 'import/path-not-absolute');
    expect(pathWarning).to.not.be.undefined;
    expect(pathWarning!.severity).to.equal(DiagnosticSeverity.Warning);
  });

  it('attaches diagnostics to the correct line', async () => {
    fsExistsStub.returns(false);
    const doc = makeDocument(
      `sub init()\nend sub\n' @import /missing.brs\nsub other()\nend sub`
    );
    const diags = await provider.provideDiagnostics(doc);

    const importDiag = diags.find((d) => d.code === 'import/unresolved');
    expect(importDiag).to.not.be.undefined;
    // @import is on line index 2 (0-based)
    expect(importDiag!.range.start.line).to.equal(2);
  });
});
