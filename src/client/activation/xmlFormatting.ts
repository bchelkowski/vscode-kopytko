import * as vscode from 'vscode';
import { formatXml, DEFAULT_FORMATTING_CONFIG, parseFormattingConfig } from 'kopytko-formatter';
import type { FormattingConfig } from 'kopytko-formatter';

/**
 * Formats SceneGraph `.xml` component `<interface>` blocks (field/function sorting only) via a
 * client-side `DocumentFormattingEditProvider`, deliberately bypassing the language server.
 *
 * The LSP client's static documentSelector (`languageServer.ts`) is `.brs`/`.kopytkorc` only, on
 * purpose (see `findings/lsp-architecture.md`'s "Never add .xml to the client's documentSelector"
 * rule — broadening it would advertise every other server capability for XML too). A dynamic
 * server-side registration would work around that, but the client only syncs documents matching
 * its *static* selector — so a dynamically-registered XML formatter would only ever see
 * last-saved-to-disk content, and applying edits computed against stale text to a live, unsaved
 * buffer risks corrupting it. Registering the provider here instead reads `document.getText()`
 * directly from the live in-memory buffer — no LSP round-trip, no sync gap, no risk.
 */
export function registerXmlFormatting(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: 'xml', pattern: '**/*.xml' },
      {
        provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
          const text = document.getText();
          const newText = formatXml(text, readFormattingConfig(document.uri));
          if (newText === text) return [];
          return [vscode.TextEdit.replace(
            new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
            newText,
          )];
        },
      },
    ),
  );
}

function readFormattingConfig(uri: vscode.Uri): FormattingConfig {
  const raw = vscode.workspace.getConfiguration('kopytko.format', uri);
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_FORMATTING_CONFIG)) {
    record[key] = raw.get(key);
  }
  return parseFormattingConfig(record);
}
