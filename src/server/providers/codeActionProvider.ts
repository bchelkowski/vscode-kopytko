import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Diagnostic,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCachedLines } from '../utils/documentCache';

/** Diagnostic codes for which we offer quick fixes. */
const FIXABLE_CODES = new Set([
  'import/unresolved',
  'import/unused',
  'import/duplicate',
  'import/missing-path',
  'import/path-not-absolute',
  'import/wrong-comment-style',
  'identifier/unused-parameter',
]);

export class BrightScriptCodeActionProvider {
  provideCodeActions(
    document: TextDocument,
    params: CodeActionParams,
  ): CodeAction[] {
    const actions: CodeAction[] = [];
    const lines = getCachedLines(document);

    for (const diag of params.context.diagnostics) {
      if (diag.source !== 'kopytko') continue;
      const code = diag.code as string;
      if (!FIXABLE_CODES.has(code)) continue;

      const lineIndex = diag.range.start.line;
      const lineText = lines[lineIndex] ?? '';

      if (code === 'import/path-not-absolute') {
        const fix = makeAddLeadingSlashAction(document.uri, lineText, lineIndex, diag);
        if (fix) actions.push(fix);
      }

      if (code === 'import/wrong-comment-style') {
        const fix = makeApostropheStyleAction(document.uri, lineText, lineIndex, diag);
        if (fix) actions.push(fix);
      }

      if (code === 'identifier/unused-parameter') {
        actions.push(makePrefixUnderscoreAction(document.uri, diag));
        continue;
      }

      if (code === 'import/unused') {
        actions.push(makeRemoveLineAction(document.uri, lineIndex, lines.length, lineText.length, diag, 'Remove unused @import line'));
        continue;
      }

      if (code === 'import/duplicate') {
        actions.push(makeRemoveLineAction(document.uri, lineIndex, lines.length, lineText.length, diag, 'Remove duplicate @import line'));
        continue;
      }

      actions.push(makeRemoveLineAction(document.uri, lineIndex, lines.length, lineText.length, diag));
    }

    // When there are multiple unused-parameter fixes, add a combined action
    // so all edits are applied simultaneously (avoiding column-shift issues).
    const unusedParamDiags = params.context.diagnostics.filter(
      (d) => d.source === 'kopytko' && d.code === 'identifier/unused-parameter',
    );
    if (unusedParamDiags.length > 1) {
      const edits = unusedParamDiags.map((d) => TextEdit.insert(d.range.start, '_'));
      actions.push({
        title: `Fix: prefix all ${unusedParamDiags.length} unused parameters with _`,
        kind: CodeActionKind.QuickFix,
        diagnostics: unusedParamDiags,
        isPreferred: true,
        edit: { changes: { [document.uri]: edits } },
      });
    }

    return actions;
  }
}

function makeRemoveLineAction(
  uri: string,
  lineIndex: number,
  totalLines: number,
  lineLength: number,
  diagnostic: Diagnostic,
  title = 'Remove @import line',
): CodeAction {
  const range: Range = lineIndex + 1 < totalLines
    ? Range.create(lineIndex, 0, lineIndex + 1, 0)
    : Range.create(lineIndex, 0, lineIndex, lineLength);

  return {
    title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    isPreferred: false,
    edit: { changes: { [uri]: [TextEdit.del(range)] } },
  };
}

function makeAddLeadingSlashAction(
  uri: string,
  lineText: string,
  lineIndex: number,
  diagnostic: Diagnostic,
): CodeAction | null {
  const match = /'\s*@import\s+(\S+)/.exec(lineText);
  if (!match) return null;

  const pathStart = match.index + match[0].length - match[1].length;

  return {
    title: 'Fix: add leading / to import path',
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    isPreferred: true,
    edit: {
      changes: {
        [uri]: [TextEdit.insert(Position.create(lineIndex, pathStart), '/')],
      },
    },
  };
}

function makeApostropheStyleAction(
  uri: string,
  lineText: string,
  lineIndex: number,
  diagnostic: Diagnostic,
): CodeAction | null {
  const quoteIdx = lineText.indexOf('"@import');
  if (quoteIdx < 0) return null;

  return {
    title: "Fix: use apostrophe comment style (' @import)",
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    isPreferred: true,
    edit: {
      changes: {
        [uri]: [TextEdit.replace(Range.create(lineIndex, quoteIdx, lineIndex, quoteIdx + 1), "' ")],
      },
    },
  };
}

function makePrefixUnderscoreAction(
  uri: string,
  diagnostic: Diagnostic,
): CodeAction {
  const paramStart = diagnostic.range.start;
  return {
    title: 'Fix: prefix with _ to mark as unused',
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    isPreferred: true,
    edit: {
      changes: {
        [uri]: [TextEdit.insert(paramStart, '_')],
      },
    },
  };
}
