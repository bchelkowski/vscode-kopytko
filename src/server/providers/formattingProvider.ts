import { TextEdit, Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { formatText } from 'kopytko-formatter';
import { CasingConfig, DEFAULT_CASING_CONFIG } from 'kopytko-brightscript-parser';
import { FunctionDefinition } from '../brightscript/functionIndex';
import { FormattingConfig } from '../brightscript/formattingConfig';

/**
 * Thin LSP adapter wrapping the standalone kopytko-formatter engine.
 * Converts TextDocument ↔ string and TextEdit result types.
 */
export class BrightScriptFormattingProvider {
  private _isReadOnly: (uri: string) => boolean = () => false;

  /** Inject a predicate that returns true for documents that should not be formatted. */
  setReadOnlyCheck(check: (uri: string) => boolean): void {
    this._isReadOnly = check;
  }

  provideDocumentFormatting(
    document: TextDocument,
    formattingConfig: FormattingConfig,
    casing: CasingConfig = DEFAULT_CASING_CONFIG,
    userFunctions: FunctionDefinition[] = [],
  ): TextEdit[] {
    if (this._isReadOnly(document.uri)) return [];

    const text = document.getText();

    const newText = formatText(text, formattingConfig, casing, userFunctions);

    if (newText === text) return [];

    return [TextEdit.replace(
      Range.create(Position.create(0, 0), document.positionAt(text.length)),
      newText,
    )];
  }
}

