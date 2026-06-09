import { TextEdit, Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { formatText } from 'kopytko-formatter';
import { CasingConfig, DEFAULT_CASING_CONFIG } from '../brightscript/casingUtils';
import { FunctionDefinition } from '../brightscript/functionIndex';
import { FormattingConfig } from '../brightscript/formattingConfig';

/**
 * Thin LSP adapter wrapping the standalone kopytko-formatter engine.
 * Converts TextDocument ↔ string and TextEdit result types.
 */
export class BrightScriptFormattingProvider {
  provideDocumentFormatting(
    document: TextDocument,
    formattingConfig: FormattingConfig,
    casing: CasingConfig = DEFAULT_CASING_CONFIG,
    userFunctions: FunctionDefinition[] = [],
  ): TextEdit[] {
    const text = document.getText();

    const newText = formatText(text, formattingConfig, casing, userFunctions);

    if (newText === text) return [];

    return [TextEdit.replace(
      Range.create(Position.create(0, 0), document.positionAt(text.length)),
      newText,
    )];
  }
}

