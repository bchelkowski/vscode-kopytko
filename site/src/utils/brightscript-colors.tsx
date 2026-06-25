/**
 * Shared BrightScript syntax-coloring utility for React components.
 * Converts source text → an array of colored <span> nodes using the
 * kopytko-brightscript-parser tokenizer.
 */
import { tokenize, TokenKind, isTypeKeyword } from 'kopytko-brightscript-parser';

export const TOKEN_COLORS: Record<string, string> = {
  keyword:      '#c792ea',
  'str-literal':'#c3e88d',
  'num-literal':'#f78c6c',
  'bool-literal':'#c792ea',
  identifier:   '#82aaff',
  type:         '#4ec9b0',
  operator:     '#89ddff',
  punctuation:  '#7e8da0',
  comment:      '#546e7a',
  preprocessor: '#ffcb6b',
};

const KEYWORD_KINDS = new Set([
  'And','As','Box','Catch','Continue','CreateObject','Dim','Each','Else','ElseIf',
  'End','EndFor','EndFunction','EndIf','EndSub','EndTry','EndWhile','Eval','Exit',
  'ExitWhile','False','For','Function','GetGlobalAA','GetLastRunCompileError',
  'GetLastRunRunTimeError','Goto','If','In','Invalid','Let','LineNum','Mod','Next',
  'Not','ObjFun','Or','Pos','Print','Return','Run','Step','Stop','Sub','Tab','Then',
  'Throw','To','True','Try','Type','While',
]);
const OPERATOR_KINDS = new Set([
  'Plus','Minus','Star','Slash','Backslash','Caret','Equal','LessGreater','Less',
  'Greater','LessEqual','GreaterEqual','LeftShift','RightShift','PlusEqual',
  'MinusEqual','StarEqual','SlashEqual','BackslashEqual','LeftShiftEqual',
  'RightShiftEqual','PlusPlus','MinusMinus','QuestionDot','QuestionBracket',
  'QuestionParen','QuestionAt',
]);
const PUNCT_KINDS = new Set([
  'LeftParen','RightParen','LeftBracket','RightBracket','LeftBrace','RightBrace',
  'Dot','Comma','Colon','Semicolon','At','QuestionMark',
]);

export function tokenColor(kind: string): string {
  if (isTypeKeyword(kind as Parameters<typeof isTypeKeyword>[0])) return TOKEN_COLORS['type'];
  if (kind === 'True' || kind === 'False' || kind === 'Invalid') return TOKEN_COLORS['bool-literal'];
  if (KEYWORD_KINDS.has(kind))   return TOKEN_COLORS['keyword'];
  if (kind === 'StringLiteral')  return TOKEN_COLORS['str-literal'];
  if (['IntegerLiteral','LongIntegerLiteral','FloatLiteral','DoubleLiteral'].includes(kind))
    return TOKEN_COLORS['num-literal'];
  if (kind === 'Identifier')     return TOKEN_COLORS['identifier'];
  if (OPERATOR_KINDS.has(kind))  return TOKEN_COLORS['operator'];
  if (PUNCT_KINDS.has(kind))     return TOKEN_COLORS['punctuation'];
  if (['HashIf','HashElseIf','HashElse','HashEndIf','HashConst','HashError'].includes(kind))
    return TOKEN_COLORS['preprocessor'];
  return '#e2e8f0';
}

let _nextKey = 0;
export function renderHighlighted(source: string): React.ReactNode[] {
  try {
    const tokens = tokenize(source);
    const parts: React.ReactNode[] = [];
    for (const tok of tokens) {
      for (const t of tok.leadingTrivia)
        parts.push(<span key={_nextKey++}>{t.text}</span>);
      if (tok.kind !== TokenKind.Eof) {
        const isComment = (tok.kind as string) === 'Comment' || (tok.kind as string) === 'RemComment';
        const color = isComment ? TOKEN_COLORS['comment'] : tokenColor(tok.kind);
        parts.push(<span key={_nextKey++} style={{ color }}>{tok.text}</span>);
      }
      for (const t of tok.trailingTrivia) {
        const isComment = t.kind === 'Comment' || t.kind === 'RemComment';
        parts.push(
          isComment
            ? <span key={_nextKey++} style={{ color: TOKEN_COLORS['comment'] }}>{t.text}</span>
            : <span key={_nextKey++}>{t.text}</span>
        );
      }
    }
    return parts;
  } catch {
    return [<span key={_nextKey++}>{source}</span>];
  }
}
