import { expect } from 'chai';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CodeActionKind,
  CodeActionParams,
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver/node';
import { BrightScriptCodeActionProvider } from '../../src/server/providers/codeActionProvider';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOCUMENT_URI = 'file:///workspace/test.brs';

function makeDocument(content: string): TextDocument {
  return TextDocument.create(DOCUMENT_URI, 'brightscript', 1, content);
}

function makeDiag(
  code: string,
  lineIndex: number,
  message = 'test diagnostic',
): Diagnostic {
  return {
    severity: DiagnosticSeverity.Warning,
    range: { start: { line: lineIndex, character: 0 }, end: { line: lineIndex, character: 65535 } },
    message,
    source: 'kopytko',
    code,
  };
}

function makeParams(diagnostics: Diagnostic[]): CodeActionParams {
  return {
    textDocument: { uri: DOCUMENT_URI },
    range: Range.create(0, 0, 0, 0),
    context: { diagnostics, only: undefined },
  };
}

// ---------------------------------------------------------------------------

describe('BrightScriptCodeActionProvider', () => {
  let provider: BrightScriptCodeActionProvider;

  beforeEach(() => {
    provider = new BrightScriptCodeActionProvider();
  });

  // The provider now reads getCachedLines(); clear the shared document cache
  // between tests so reused URIs/versions don't return another test's lines.
  afterEach(() => invalidateAllCaches());

  // ── No actions for non-kopytko diagnostics ────────────────────────────────

  it('returns no actions when there are no diagnostics', () => {
    const doc = makeDocument("' @import /file.brs\n");
    const result = provider.provideCodeActions(doc, makeParams([]));
    expect(result).to.have.length(0);
  });

  it('ignores diagnostics from other sources', () => {
    const diag: Diagnostic = { ...makeDiag('import/unresolved', 0), source: 'eslint' };
    const doc = makeDocument("' @import /file.brs\n");
    const result = provider.provideCodeActions(doc, makeParams([diag]));
    expect(result).to.have.length(0);
  });

  it('ignores kopytko diagnostics with non-import codes', () => {
    const diag = makeDiag('identifier/undefined-function', 0);
    const doc = makeDocument('unknownFn()\n');
    const result = provider.provideCodeActions(doc, makeParams([diag]));
    expect(result).to.have.length(0);
  });

  it('ignores import/build-generated (informational only)', () => {
    const diag = makeDiag('import/build-generated', 0);
    const doc = makeDocument("' @import /generated/file.brs\n");
    const result = provider.provideCodeActions(doc, makeParams([diag]));
    expect(result).to.have.length(0);
  });

  // ── import/unresolved ─────────────────────────────────────────────────────

  describe('import/unresolved', () => {
    it('offers only "Remove @import line"', () => {
      const doc = makeDocument("' @import /missing.brs\n");
      const diag = makeDiag('import/unresolved', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      expect(result).to.have.length(1);
      expect(result[0].title).to.equal('Remove @import line');
      expect(result[0].kind).to.equal(CodeActionKind.QuickFix);
    });

    it('remove action deletes the line including trailing newline', () => {
      const doc = makeDocument("' @import /missing.brs\nnext line\n");
      const diag = makeDiag('import/unresolved', 0);
      const [action] = provider.provideCodeActions(doc, makeParams([diag]));
      const edits = action.edit!.changes![DOCUMENT_URI];
      expect(edits).to.have.length(1);
      expect(edits[0].range.start).to.deep.equal({ line: 0, character: 0 });
      expect(edits[0].range.end).to.deep.equal({ line: 1, character: 0 });
      expect(edits[0].newText).to.equal('');
    });

    it('remove action on last line does not exceed document bounds', () => {
      const doc = makeDocument("' @import /missing.brs");
      const diag = makeDiag('import/unresolved', 0);
      const [action] = provider.provideCodeActions(doc, makeParams([diag]));
      const edits = action.edit!.changes![DOCUMENT_URI];
      // Last line: range extends to end of that line, not to line+1
      expect(edits[0].range.start.line).to.equal(0);
      expect(edits[0].range.end.line).to.equal(0);
    });

    it('links the diagnostic to the action', () => {
      const doc = makeDocument("' @import /missing.brs\n");
      const diag = makeDiag('import/unresolved', 0);
      const [action] = provider.provideCodeActions(doc, makeParams([diag]));
      expect(action.diagnostics).to.deep.include(diag);
    });
  });

  // ── import/missing-path ───────────────────────────────────────────────────

  describe('import/missing-path', () => {
    it('offers only "Remove @import line"', () => {
      const doc = makeDocument("' @import\n");
      const diag = makeDiag('import/missing-path', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      expect(result).to.have.length(1);
      expect(result[0].title).to.equal('Remove @import line');
    });
  });

  // ── import/path-not-absolute ──────────────────────────────────────────────

  describe('import/path-not-absolute', () => {
    it('offers "Fix: add leading /" as preferred, and "Remove @import line"', () => {
      const doc = makeDocument("' @import components/foo.brs\n");
      const diag = makeDiag('import/path-not-absolute', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      expect(result).to.have.length(2);
      const fix = result.find((a) => a.title.includes('add leading'));
      const remove = result.find((a) => a.title === 'Remove @import line');
      expect(fix).to.exist;
      expect(fix!.isPreferred).to.equal(true);
      expect(remove).to.exist;
    });

    it('add-leading-slash inserts "/" at the correct column', () => {
      const line = "' @import components/foo.brs";
      const doc = makeDocument(line + '\n');
      const diag = makeDiag('import/path-not-absolute', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      const fix = result.find((a) => a.title.includes('add leading'))!;
      const edits = fix.edit!.changes![DOCUMENT_URI];
      expect(edits).to.have.length(1);
      // The edit should be an insertion (start === end) at the start of "components/..."
      const pathStart = line.indexOf('components');
      expect(edits[0].range.start).to.deep.equal({ line: 0, character: pathStart });
      expect(edits[0].range.end).to.deep.equal({ line: 0, character: pathStart });
      expect(edits[0].newText).to.equal('/');
    });

    it('handles a "from" clause correctly', () => {
      const line = "' @import utils/helper.brs from @kopytko/utils";
      const doc = makeDocument(line + '\n');
      const diag = makeDiag('import/path-not-absolute', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      const fix = result.find((a) => a.title.includes('add leading'))!;
      const edits = fix.edit!.changes![DOCUMENT_URI];
      const pathStart = line.indexOf('utils/helper');
      expect(edits[0].range.start.character).to.equal(pathStart);
      expect(edits[0].newText).to.equal('/');
    });

    it('returns no fix action when line does not match import pattern', () => {
      // Diagnostic on an unrecognisable line — fix should be suppressed
      const doc = makeDocument('not an import line\n');
      const diag = makeDiag('import/path-not-absolute', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      // No "add leading /" action, only remove
      expect(result).to.have.length(1);
      expect(result[0].title).to.equal('Remove @import line');
    });
  });

  // ── import/wrong-comment-style ────────────────────────────────────────────

  describe('import/wrong-comment-style', () => {
    it('offers apostrophe fix as preferred, and "Remove @import line"', () => {
      const doc = makeDocument('"@import /file.brs\n');
      const diag = makeDiag('import/wrong-comment-style', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      expect(result).to.have.length(2);
      const fix = result.find((a) => a.title.includes('apostrophe'));
      const remove = result.find((a) => a.title === 'Remove @import line');
      expect(fix).to.exist;
      expect(fix!.isPreferred).to.equal(true);
      expect(remove).to.exist;
    });

    it('apostrophe fix replaces the double-quote with "apostrophe + space"', () => {
      const line = '"@import /file.brs';
      const doc = makeDocument(line + '\n');
      const diag = makeDiag('import/wrong-comment-style', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      const fix = result.find((a) => a.title.includes('apostrophe'))!;
      const edits = fix.edit!.changes![DOCUMENT_URI];
      expect(edits).to.have.length(1);
      const quoteIdx = line.indexOf('"');
      expect(edits[0].range.start).to.deep.equal({ line: 0, character: quoteIdx });
      expect(edits[0].range.end).to.deep.equal({ line: 0, character: quoteIdx + 1 });
      expect(edits[0].newText).to.equal("' ");
    });

    it('returns no apostrophe fix when line has no "double-quote @import"', () => {
      const doc = makeDocument("some other line\n");
      const diag = makeDiag('import/wrong-comment-style', 0);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      expect(result).to.have.length(1);
      expect(result[0].title).to.equal('Remove @import line');
    });
  });

  // ── import/duplicate ───────────────────────────────────────────────────────

  describe('import/duplicate', () => {
    it('offers "Remove duplicate @import line"', () => {
      const doc = makeDocument(
        "' @import /utils/Math.brs\n" +
        "' @import /utils/Math.brs\n",
      );
      const diag = makeDiag('import/duplicate', 1);
      const result = provider.provideCodeActions(doc, makeParams([diag]));
      expect(result).to.have.length(1);
      expect(result[0].title).to.equal('Remove duplicate @import line');
      expect(result[0].kind).to.equal(CodeActionKind.QuickFix);
    });

    it('remove action deletes the duplicate line', () => {
      const doc = makeDocument(
        "' @import /utils/Math.brs\n" +
        "' @import /utils/Math.brs\n" +
        'function test()\nend function\n',
      );
      const diag = makeDiag('import/duplicate', 1);
      const [action] = provider.provideCodeActions(doc, makeParams([diag]));
      const edits = action.edit!.changes![DOCUMENT_URI];
      expect(edits).to.have.length(1);
      expect(edits[0].range.start).to.deep.equal({ line: 1, character: 0 });
      expect(edits[0].range.end).to.deep.equal({ line: 2, character: 0 });
      expect(edits[0].newText).to.equal('');
    });
  });

  // ── identifier/unused-parameter ────────────────────────────────────────────

  describe('identifier/unused-parameter', () => {
    it('inserts _ at the correct character position from diagnostic range', () => {
      const line = 'function _onStatusFetch(promise as Object, m as Object) as Boolean';
      const mCol = line.indexOf(', m') + 2;
      const doc = makeDocument(line + '\n  print promise\nend function\n');

      const diag: Diagnostic = {
        severity: DiagnosticSeverity.Warning,
        range: { start: { line: 0, character: mCol }, end: { line: 0, character: mCol + 1 } },
        message: 'Parameter "m" is never used.',
        source: 'kopytko',
        code: 'identifier/unused-parameter',
      };

      const result = provider.provideCodeActions(doc, makeParams([diag]));
      expect(result).to.have.length(1);
      expect(result[0].title).to.include('prefix with _');
      expect(result[0].isPreferred).to.be.true;

      const edits = result[0].edit!.changes![DOCUMENT_URI];
      expect(edits).to.have.length(1);
      expect(edits[0].range.start).to.deep.equal({ line: 0, character: mCol });
      expect(edits[0].range.end).to.deep.equal({ line: 0, character: mCol });
      expect(edits[0].newText).to.equal('_');
    });
  });

  // ── Multiple diagnostics ──────────────────────────────────────────────────

  it('handles multiple diagnostics on different lines', () => {
    const doc = makeDocument(
      "' @import /missing.brs\n" +
      "' @import bad/path.brs\n" +
      '"@import /wrongstyle.brs\n',
    );
    const diags = [
      makeDiag('import/unresolved', 0),
      makeDiag('import/path-not-absolute', 1),
      makeDiag('import/wrong-comment-style', 2),
    ];
    const result = provider.provideCodeActions(doc, makeParams(diags));
    // line 0: 1 action; line 1: 2 actions; line 2: 2 actions → 5 total
    expect(result).to.have.length(5);
  });
});
