import { expect } from 'chai';
import * as sinon from 'sinon';
import { SymbolKind } from 'vscode-languageserver/node';
import fsWrapper from '../../src/server/utils/fsWrapper';
import { BrightScriptWorkspaceSymbolProvider } from '../../src/server/providers/workspaceSymbolProvider';
import { KopytkoImportResolver } from '../../src/server/kopytko/importResolver';

const makeResolver = (workspaceFolders: string[] = ['/project']) =>
  new KopytkoImportResolver({ workspaceFolders, sourceDir: 'app', resolveModules: false });

describe('BrightScriptWorkspaceSymbolProvider', () => {
  let readdirStub: sinon.SinonStub;
  let readFileStub: sinon.SinonStub;
  let provider: BrightScriptWorkspaceSymbolProvider;

  beforeEach(() => {
    readdirStub = sinon.stub(fsWrapper, 'readdirTyped').returns([]);
    readFileStub = sinon.stub(fsWrapper, 'readFileSync').returns('');
    provider = new BrightScriptWorkspaceSymbolProvider(makeResolver());
  });

  afterEach(() => sinon.restore());

  it('returns empty array when no workspace files exist', () => {
    expect(provider.provideWorkspaceSymbols('')).to.be.empty;
  });

  it('returns empty array when no workspace folders are configured', () => {
    provider = new BrightScriptWorkspaceSymbolProvider(makeResolver([]));
    expect(provider.provideWorkspaceSymbols('')).to.be.empty;
  });

  // ── top-level functions ───────────────────────────────────────────────────

  it('returns a symbol for each top-level function', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Main.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Main.brs', 'utf-8').returns([
      'function doWork()',
      'end function',
      '',
      'sub init()',
      'end sub',
    ].join('\n'));

    const names = provider.provideWorkspaceSymbols('').map((s) => s.name);
    expect(names).to.include('doWork');
    expect(names).to.include('init');
  });

  it('top-level functions have SymbolKind.Function', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Foo.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Foo.brs', 'utf-8').returns('function foo()\nend function');

    const symbol = provider.provideWorkspaceSymbols('')[0];
    expect(symbol.kind).to.equal(SymbolKind.Function);
  });

  it('symbol location points to the function name token', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Foo.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Foo.brs', 'utf-8').returns('function greet(name as String)\nend function');

    const symbol = provider.provideWorkspaceSymbols('')[0];
    // "function " = 9 chars → name starts at column 9
    expect(symbol.location.range.start.line).to.equal(0);
    expect(symbol.location.range.start.character).to.equal(9);
    expect(symbol.location.range.end.character).to.equal(9 + 'greet'.length);
  });

  // ── inner AA methods ──────────────────────────────────────────────────────

  it('returns inner methods as SymbolKind.Method symbols', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Counter.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Counter.brs', 'utf-8').returns([
      'function Counter() as Object',
      '  this = {}',
      '  this.increment = function()',
      '  end function',
      '  return this',
      'end function',
    ].join('\n'));

    const symbols = provider.provideWorkspaceSymbols('');
    const method = symbols.find((s) => s.name === 'increment');
    expect(method).to.exist;
    expect(method!.kind).to.equal(SymbolKind.Method);
  });

  it('inner methods carry the owning function name as containerName', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Counter.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Counter.brs', 'utf-8').returns([
      'function Counter() as Object',
      '  this = {}',
      '  this.increment = function()',
      '  end function',
      '  return this',
      'end function',
    ].join('\n'));

    const method = provider.provideWorkspaceSymbols('').find((s) => s.name === 'increment');
    expect(method!.containerName).to.equal('Counter');
  });

  it('detects inline AA literal methods (colon syntax)', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Widget.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Widget.brs', 'utf-8').returns([
      'function Widget() as Object',
      '  return {',
      '    render: function()',
      '    end function',
      '  }',
      'end function',
    ].join('\n'));

    const method = provider.provideWorkspaceSymbols('').find((s) => s.name === 'render');
    expect(method).to.exist;
    expect(method!.kind).to.equal(SymbolKind.Method);
    expect(method!.containerName).to.equal('Widget');
  });

  // ── query filtering ───────────────────────────────────────────────────────

  it('empty query returns all symbols', () => {
    readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/App.brs', 'utf-8').returns([
      'function doWork()',
      'end function',
      'function cleanup()',
      'end function',
    ].join('\n'));

    expect(provider.provideWorkspaceSymbols('')).to.have.length(2);
  });

  it('filters by case-insensitive substring match', () => {
    readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/App.brs', 'utf-8').returns([
      'function getUserName()',
      'end function',
      'function cleanup()',
      'end function',
    ].join('\n'));

    const results = provider.provideWorkspaceSymbols('user');
    expect(results).to.have.length(1);
    expect(results[0].name).to.equal('getUserName');
  });

  it('query matching is case-insensitive', () => {
    readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/App.brs', 'utf-8').returns('function MyFunction()\nend function');

    expect(provider.provideWorkspaceSymbols('MYFUNCTION')).to.have.length(1);
    expect(provider.provideWorkspaceSymbols('myfunc')).to.have.length(1);
    expect(provider.provideWorkspaceSymbols('MYFunc')).to.have.length(1);
  });

  it('returns empty array when query matches nothing', () => {
    readdirStub.withArgs('/project').returns([{ name: 'App.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/App.brs', 'utf-8').returns('function doWork()\nend function');

    expect(provider.provideWorkspaceSymbols('zzznomatch')).to.be.empty;
  });

  it('query also filters inner methods', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Counter.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Counter.brs', 'utf-8').returns([
      'function Counter() as Object',
      '  this = {}',
      '  this.increment = function()',
      '  end function',
      '  this.reset = sub()',
      '  end sub',
      '  return this',
      'end function',
    ].join('\n'));

    const results = provider.provideWorkspaceSymbols('reset');
    expect(results).to.have.length(1);
    expect(results[0].name).to.equal('reset');
  });

  // ── file system traversal ─────────────────────────────────────────────────

  it('skips node_modules directories', () => {
    readdirStub.withArgs('/project').returns([
      { name: 'node_modules', isDirectory: true },
      { name: 'App.brs', isDirectory: false },
    ]);
    readdirStub.withArgs('/project/App.brs').throws(new Error('should not enter file'));
    readFileStub.withArgs('/project/App.brs', 'utf-8').returns('function appFn()\nend function');

    const names = provider.provideWorkspaceSymbols('').map((s) => s.name);
    expect(names).to.deep.equal(['appFn']);
  });

  it('skips hidden directories (names starting with .)', () => {
    readdirStub.withArgs('/project').returns([
      { name: '.git', isDirectory: true },
      { name: 'App.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/project/App.brs', 'utf-8').returns('function visible()\nend function');

    const names = provider.provideWorkspaceSymbols('').map((s) => s.name);
    expect(names).to.deep.equal(['visible']);
  });

  it('recurses into subdirectories', () => {
    readdirStub.withArgs('/project').returns([{ name: 'components', isDirectory: true }]);
    readdirStub.withArgs('/project/components').returns([{ name: 'Button.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/components/Button.brs', 'utf-8').returns(
      'function ButtonInit()\nend function'
    );

    const names = provider.provideWorkspaceSymbols('').map((s) => s.name);
    expect(names).to.include('ButtonInit');
  });

  it('collects symbols from multiple files across multiple directories', () => {
    readdirStub.withArgs('/project').returns([
      { name: 'A.brs', isDirectory: false },
      { name: 'sub', isDirectory: true },
    ]);
    readdirStub.withArgs('/project/sub').returns([{ name: 'B.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/A.brs', 'utf-8').returns('function fnA()\nend function');
    readFileStub.withArgs('/project/sub/B.brs', 'utf-8').returns('function fnB()\nend function');

    const names = provider.provideWorkspaceSymbols('').map((s) => s.name);
    expect(names).to.include('fnA');
    expect(names).to.include('fnB');
  });

  it('handles unreadable files gracefully without throwing', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Bad.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Bad.brs', 'utf-8').throws(new Error('EACCES'));

    expect(() => provider.provideWorkspaceSymbols('')).not.to.throw();
    expect(provider.provideWorkspaceSymbols('')).to.be.empty;
  });

  it('ignores non-.brs files', () => {
    readdirStub.withArgs('/project').returns([
      { name: 'script.js', isDirectory: false },
      { name: 'readme.md', isDirectory: false },
      { name: 'App.brs', isDirectory: false },
    ]);
    readFileStub.withArgs('/project/App.brs', 'utf-8').returns('function appFn()\nend function');

    const names = provider.provideWorkspaceSymbols('').map((s) => s.name);
    expect(names).to.deep.equal(['appFn']);
  });

  it('symbol location uri uses the file:// scheme', () => {
    readdirStub.withArgs('/project').returns([{ name: 'Foo.brs', isDirectory: false }]);
    readFileStub.withArgs('/project/Foo.brs', 'utf-8').returns('function foo()\nend function');

    const symbol = provider.provideWorkspaceSymbols('')[0];
    expect(symbol.location.uri).to.match(/^file:\/\//);
    expect(symbol.location.uri).to.include('Foo.brs');
  });

  it('collects symbols from multiple workspace folders', () => {
    provider = new BrightScriptWorkspaceSymbolProvider(
      makeResolver(['/project1', '/project2'])
    );
    readdirStub.withArgs('/project1').returns([{ name: 'A.brs', isDirectory: false }]);
    readdirStub.withArgs('/project2').returns([{ name: 'B.brs', isDirectory: false }]);
    readFileStub.withArgs('/project1/A.brs', 'utf-8').returns('function fnA()\nend function');
    readFileStub.withArgs('/project2/B.brs', 'utf-8').returns('function fnB()\nend function');

    const names = provider.provideWorkspaceSymbols('').map((s) => s.name);
    expect(names).to.include('fnA');
    expect(names).to.include('fnB');
  });
});
