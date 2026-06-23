/**
 * Every token kind that the BrightScript lexer can produce.
 *
 * Derived from the official Roku documentation:
 * - Reserved words: https://developer.roku.com/dev/docs/reserved-words
 * - Operators:      https://developer.roku.com/dev/docs/expressions-variables-types
 * - Statements:     https://developer.roku.com/dev/docs/program-statements
 * - Conditionals:   https://developer.roku.com/dev/docs/conditional-compilation
 */
export enum TokenKind {
  // ── Literals ────────────────────────────────────────────────────────────
  IntegerLiteral = 'IntegerLiteral',
  LongIntegerLiteral = 'LongIntegerLiteral',
  FloatLiteral = 'FloatLiteral',
  DoubleLiteral = 'DoubleLiteral',
  StringLiteral = 'StringLiteral',

  // ── Identifiers ─────────────────────────────────────────────────────────
  Identifier = 'Identifier',

  // ── Reserved words / keywords ───────────────────────────────────────────
  // From https://developer.roku.com/dev/docs/reserved-words
  And = 'And',
  As = 'As',
  Box = 'Box',
  Catch = 'Catch',
  Continue = 'Continue',
  CreateObject = 'CreateObject',
  Dim = 'Dim',
  Each = 'Each',
  Else = 'Else',
  ElseIf = 'ElseIf',
  End = 'End',
  EndFor = 'EndFor',
  EndFunction = 'EndFunction',
  EndIf = 'EndIf',
  EndSub = 'EndSub',
  EndWhile = 'EndWhile',
  EndTry = 'EndTry',
  Eval = 'Eval',
  Exit = 'Exit',
  ExitWhile = 'ExitWhile',
  False = 'False',
  For = 'For',
  Function = 'Function',
  GetGlobalAA = 'GetGlobalAA',
  GetLastRunCompileError = 'GetLastRunCompileError',
  GetLastRunRunTimeError = 'GetLastRunRunTimeError',
  Goto = 'Goto',
  If = 'If',
  In = 'In',
  Invalid = 'Invalid',
  Let = 'Let',
  LineNum = 'LineNum',
  Mod = 'Mod',
  Next = 'Next',
  Not = 'Not',
  ObjFun = 'ObjFun',
  Or = 'Or',
  Pos = 'Pos',
  Print = 'Print',
  Return = 'Return',
  Run = 'Run',
  Step = 'Step',
  Stop = 'Stop',
  Sub = 'Sub',
  Tab = 'Tab',
  Then = 'Then',
  Throw = 'Throw',
  To = 'To',
  True = 'True',
  Try = 'Try',
  Type = 'Type',
  While = 'While',

  // ── Operators ───────────────────────────────────────────────────────────
  // Arithmetic
  Plus = 'Plus',                     // +
  Minus = 'Minus',                   // -
  Star = 'Star',                     // *
  Slash = 'Slash',                   // /
  Backslash = 'Backslash',           // \ (integer division)
  Caret = 'Caret',                   // ^

  // Comparison
  Equal = 'Equal',                   // =
  LessGreater = 'LessGreater',       // <>
  Less = 'Less',                     // <
  Greater = 'Greater',               // >
  LessEqual = 'LessEqual',          // <=
  GreaterEqual = 'GreaterEqual',     // >=

  // Bitshift
  LeftShift = 'LeftShift',           // <<
  RightShift = 'RightShift',         // >>

  // Compound assignment
  PlusEqual = 'PlusEqual',           // +=
  MinusEqual = 'MinusEqual',         // -=
  StarEqual = 'StarEqual',           // *=
  SlashEqual = 'SlashEqual',         // /=
  BackslashEqual = 'BackslashEqual', // \=
  LeftShiftEqual = 'LeftShiftEqual', // <<=
  RightShiftEqual = 'RightShiftEqual', // >>=

  // Increment / decrement
  PlusPlus = 'PlusPlus',             // ++
  MinusMinus = 'MinusMinus',         // --

  // ── Optional chaining (Roku OS 11.0+) ──────────────────────────────────
  QuestionDot = 'QuestionDot',       // ?.
  QuestionBracket = 'QuestionBracket', // ?[
  QuestionParen = 'QuestionParen',   // ?(
  QuestionAt = 'QuestionAt',         // ?@

  // ── Punctuation ─────────────────────────────────────────────────────────
  LeftParen = 'LeftParen',           // (
  RightParen = 'RightParen',         // )
  LeftBracket = 'LeftBracket',       // [
  RightBracket = 'RightBracket',     // ]
  LeftBrace = 'LeftBrace',           // {
  RightBrace = 'RightBrace',         // }
  Dot = 'Dot',                       // .
  Comma = 'Comma',                   // ,
  Colon = 'Colon',                   // :
  Semicolon = 'Semicolon',           // ;
  At = 'At',                         // @
  QuestionMark = 'QuestionMark',     // ? (print shorthand — only when standalone)

  // ── Conditional compilation ─────────────────────────────────────────────
  HashIf = 'HashIf',                 // #if
  HashElseIf = 'HashElseIf',         // #else if / #elseif
  HashElse = 'HashElse',             // #else
  HashEndIf = 'HashEndIf',           // #end if / #endif
  HashConst = 'HashConst',           // #const
  HashError = 'HashError',           // #error

  // ── Special ─────────────────────────────────────────────────────────────
  Eof = 'Eof',                       // end of input

  // Error recovery
  Unknown = 'Unknown',               // unrecognized character(s)
}

/**
 * Map from lowercase keyword text → TokenKind.
 * Used by the lexer to classify identifiers as keywords.
 */
export const KEYWORD_MAP = new Map<string, TokenKind>([
  ['and', TokenKind.And],
  ['as', TokenKind.As],
  ['box', TokenKind.Box],
  ['catch', TokenKind.Catch],
  ['continue', TokenKind.Continue],
  ['createobject', TokenKind.CreateObject],
  ['dim', TokenKind.Dim],
  ['each', TokenKind.Each],
  ['else', TokenKind.Else],
  ['elseif', TokenKind.ElseIf],
  ['end', TokenKind.End],
  ['endfor', TokenKind.EndFor],
  ['endfunction', TokenKind.EndFunction],
  ['endif', TokenKind.EndIf],
  ['endsub', TokenKind.EndSub],
  ['endwhile', TokenKind.EndWhile],
  ['endtry', TokenKind.EndTry],
  ['eval', TokenKind.Eval],
  ['exit', TokenKind.Exit],
  ['exitwhile', TokenKind.ExitWhile],
  ['false', TokenKind.False],
  ['for', TokenKind.For],
  ['function', TokenKind.Function],
  ['getglobalaa', TokenKind.GetGlobalAA],
  ['getlastruncompileerror', TokenKind.GetLastRunCompileError],
  ['getlastrunruntimeerror', TokenKind.GetLastRunRunTimeError],
  ['goto', TokenKind.Goto],
  ['if', TokenKind.If],
  ['in', TokenKind.In],
  ['invalid', TokenKind.Invalid],
  ['let', TokenKind.Let],
  ['line_num', TokenKind.LineNum],
  ['mod', TokenKind.Mod],
  ['next', TokenKind.Next],
  ['not', TokenKind.Not],
  ['objfun', TokenKind.ObjFun],
  ['or', TokenKind.Or],
  ['pos', TokenKind.Pos],
  ['print', TokenKind.Print],
  ['return', TokenKind.Return],
  ['run', TokenKind.Run],
  ['step', TokenKind.Step],
  ['stop', TokenKind.Stop],
  ['sub', TokenKind.Sub],
  ['tab', TokenKind.Tab],
  ['then', TokenKind.Then],
  ['throw', TokenKind.Throw],
  ['to', TokenKind.To],
  ['true', TokenKind.True],
  ['try', TokenKind.Try],
  ['type', TokenKind.Type],
  ['while', TokenKind.While],
]);

const KEYWORD_KINDS = new Set<TokenKind>(KEYWORD_MAP.values());

/** Returns true if the token kind is a keyword (not an identifier or literal). */
export function isKeyword(kind: TokenKind): boolean {
  return KEYWORD_KINDS.has(kind);
}
