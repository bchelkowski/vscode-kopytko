import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import { Connection, DiagnosticSeverity } from 'vscode-languageserver/node';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { WorkspaceComponentIndex } from '../../src/server/utils/workspaceComponentIndex';
import {
  ComponentDiagnosticsService,
  DUPLICATE_COMPONENT_RULE,
} from '../../src/server/services/componentDiagnostics';
import { clearFileParseCache } from '../../src/server/utils/fileParseCache';

const WORKSPACE = '/workspace';
const APP_CARD = path.join(WORKSPACE, 'app', 'components', 'Card.xml');
const OUT_CARD = path.join(WORKSPACE, 'out', 'components', 'Card.xml');
const APP_BUTTON = path.join(WORKSPACE, 'app', 'components', 'Button.xml');

interface PublishedDiagnostics {
  uri: string;
  diagnostics: { message: string; code?: string | number; severity?: DiagnosticSeverity; range: unknown }[];
}

describe('ComponentDiagnosticsService', () => {
  let readdirTypedStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let sendDiagnostics: sinon.SinonStub;
  let connection: Connection;
  let index: WorkspaceComponentIndex;
  let excluded: string[];
  let severity: 'error' | 'warning' | 'info' | 'hint' | 'off';

  beforeEach(() => {
    readdirTypedStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
    readFileStub = sinon.stub(fsWrapper, 'readFileSync').returns('');
    sendDiagnostics = sinon.stub();
    connection = { sendDiagnostics } as unknown as Connection;
    index = new WorkspaceComponentIndex();
    excluded = [];
    severity = 'warning';
  });

  afterEach(() => {
    sinon.restore();
    clearFileParseCache();
  });

  function makeService(): ComponentDiagnosticsService {
    return new ComponentDiagnosticsService(connection, {
      index,
      isExcluded: (filePath) => excluded.includes(filePath),
      workspaceFolders: () => [WORKSPACE],
      severity: () => severity,
    });
  }

  /** Two files declaring `Card`, plus one unique component. */
  function stubDuplicate(): void {
    readdirTypedStub.withArgs(WORKSPACE).returns([
      { name: 'app', isDirectory: true },
      { name: 'out', isDirectory: true },
    ]);
    readdirTypedStub.withArgs(path.join(WORKSPACE, 'app')).returns([
      { name: 'components', isDirectory: true },
    ]);
    readdirTypedStub.withArgs(path.join(WORKSPACE, 'out')).returns([
      { name: 'components', isDirectory: true },
    ]);
    readdirTypedStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
      { name: 'Card.xml', isDirectory: false },
      { name: 'Button.xml', isDirectory: false },
    ]);
    readdirTypedStub.withArgs(path.join(WORKSPACE, 'out', 'components')).returns([
      { name: 'Card.xml', isDirectory: false },
    ]);
    readFileStub.withArgs(APP_CARD, 'utf-8').returns('<component name="Card" extends="Group" />');
    readFileStub.withArgs(OUT_CARD, 'utf-8').returns('<component name="Card" extends="Group" />');
    readFileStub.withArgs(APP_BUTTON, 'utf-8').returns('<component name="Button" extends="Group" />');
    index.build([WORKSPACE]);
  }

  function published(): PublishedDiagnostics[] {
    return sendDiagnostics.getCalls().map((c) => c.args[0] as PublishedDiagnostics);
  }

  it('publishes a warning on every file declaring a duplicated name', () => {
    stubDuplicate();
    makeService().refresh();

    const calls = published();
    expect(calls.map((c) => c.uri).sort()).to.deep.equal([
      `file://${APP_CARD}`,
      `file://${OUT_CARD}`,
    ]);
    for (const call of calls) {
      expect(call.diagnostics).to.have.length(1);
      expect(call.diagnostics[0].severity).to.equal(DiagnosticSeverity.Warning);
      expect(call.diagnostics[0].code).to.equal(DUPLICATE_COMPONENT_RULE);
    }
  });

  it('points each warning at the other declaration, workspace-relative', () => {
    stubDuplicate();
    makeService().refresh();

    const appDiagnostic = published().find((c) => c.uri === `file://${APP_CARD}`)!.diagnostics[0];

    expect(appDiagnostic.message).to.contain('Duplicate component name "Card"');
    expect(appDiagnostic.message).to.contain('out/components/Card.xml');
    expect(appDiagnostic.message).to.not.contain(WORKSPACE);
  });

  it('ranges the warning over the name attribute value', () => {
    stubDuplicate();
    makeService().refresh();

    // `<component name="Card" …` — the value starts at column 17
    expect(published()[0].diagnostics[0].range).to.deep.equal({
      start: { line: 0, character: 17 },
      end: { line: 0, character: 21 },
    });
  });

  it('publishes nothing when every component name is unique', () => {
    readdirTypedStub.withArgs(WORKSPACE).returns([{ name: 'Button.xml', isDirectory: false }]);
    readFileStub.withArgs(path.join(WORKSPACE, 'Button.xml'), 'utf-8')
      .returns('<component name="Button" extends="Group" />');
    index.build([WORKSPACE]);

    makeService().refresh();

    expect(sendDiagnostics.called).to.be.false;
  });

  it('ignores a duplicate whose other copy is excluded from linting', () => {
    stubDuplicate();
    excluded = [OUT_CARD];

    makeService().refresh();

    expect(sendDiagnostics.called).to.be.false;
  });

  it('publishes nothing when the rule is turned off', () => {
    stubDuplicate();
    severity = 'off';

    makeService().refresh();

    expect(sendDiagnostics.called).to.be.false;
  });

  it('maps a configured severity onto the LSP diagnostic', () => {
    stubDuplicate();
    severity = 'error';

    makeService().refresh();

    expect(published()[0].diagnostics[0].severity).to.equal(DiagnosticSeverity.Error);
  });

  it('clears a previously published warning when the rule is turned off', () => {
    stubDuplicate();
    const service = makeService();
    service.refresh();
    sendDiagnostics.resetHistory();

    severity = 'off';
    service.refresh();

    expect(published()).to.have.length(2);
    expect(published().every((c) => c.diagnostics.length === 0)).to.be.true;
  });

  it('does not warn inside node_modules, but still counts the package declaration', () => {
    const pkgCard = path.join(WORKSPACE, 'node_modules', 'kopytko-ui', 'app', 'Card.xml');
    readdirTypedStub.withArgs(WORKSPACE).returns([{ name: 'app', isDirectory: true }]);
    readdirTypedStub.withArgs(path.join(WORKSPACE, 'app')).returns([
      { name: 'components', isDirectory: true },
    ]);
    readdirTypedStub.withArgs(path.join(WORKSPACE, 'app', 'components')).returns([
      { name: 'Card.xml', isDirectory: false },
    ]);
    readdirTypedStub.withArgs(path.join(WORKSPACE, 'node_modules', 'kopytko-ui', 'app')).returns([
      { name: 'Card.xml', isDirectory: false },
    ]);
    readFileStub.withArgs(APP_CARD, 'utf-8').returns('<component name="Card" extends="Group" />');
    readFileStub.withArgs(pkgCard, 'utf-8').returns('<component name="Card" extends="Group" />');
    // The package base dir is passed as an explicit root, as buildSearchRoots does
    index.build([WORKSPACE, path.join(WORKSPACE, 'node_modules', 'kopytko-ui', 'app')]);

    makeService().refresh();

    const calls = published();
    expect(calls).to.have.length(1);
    expect(calls[0].uri).to.equal(`file://${APP_CARD}`);
    expect(calls[0].diagnostics[0].message).to.contain('kopytko-ui');
  });

  it('clears diagnostics for a file that is no longer duplicated', () => {
    stubDuplicate();
    const service = makeService();
    service.refresh();
    sendDiagnostics.resetHistory();

    index.removeFile(OUT_CARD);
    service.refresh();

    const cleared = published();
    expect(cleared.map((c) => c.uri).sort()).to.deep.equal([
      `file://${APP_CARD}`,
      `file://${OUT_CARD}`,
    ]);
    expect(cleared.every((c) => c.diagnostics.length === 0)).to.be.true;
  });

  it('does not republish clears once the duplicate is gone', () => {
    stubDuplicate();
    const service = makeService();
    service.refresh();
    index.removeFile(OUT_CARD);
    service.refresh();
    sendDiagnostics.resetHistory();

    service.refresh();

    expect(sendDiagnostics.called).to.be.false;
  });

  it('clear() empties every published file', () => {
    stubDuplicate();
    const service = makeService();
    service.refresh();
    sendDiagnostics.resetHistory();

    service.clear();

    expect(published()).to.have.length(2);
    expect(published().every((c) => c.diagnostics.length === 0)).to.be.true;
  });
});
