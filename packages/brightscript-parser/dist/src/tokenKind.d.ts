/**
 * Every token kind that the BrightScript lexer can produce.
 *
 * Derived from the official Roku documentation:
 * - Reserved words: https://developer.roku.com/dev/docs/reserved-words
 * - Operators:      https://developer.roku.com/dev/docs/expressions-variables-types
 * - Statements:     https://developer.roku.com/dev/docs/program-statements
 * - Conditionals:   https://developer.roku.com/dev/docs/conditional-compilation
 */
export declare enum TokenKind {
    IntegerLiteral = "IntegerLiteral",
    LongIntegerLiteral = "LongIntegerLiteral",
    FloatLiteral = "FloatLiteral",
    DoubleLiteral = "DoubleLiteral",
    StringLiteral = "StringLiteral",
    Identifier = "Identifier",
    And = "And",
    As = "As",
    Box = "Box",
    Catch = "Catch",
    Continue = "Continue",
    CreateObject = "CreateObject",
    Dim = "Dim",
    Each = "Each",
    Else = "Else",
    ElseIf = "ElseIf",
    End = "End",
    EndFor = "EndFor",
    EndFunction = "EndFunction",
    EndIf = "EndIf",
    EndSub = "EndSub",
    EndWhile = "EndWhile",
    EndTry = "EndTry",
    Eval = "Eval",
    Exit = "Exit",
    ExitWhile = "ExitWhile",
    False = "False",
    For = "For",
    Function = "Function",
    GetGlobalAA = "GetGlobalAA",
    GetLastRunCompileError = "GetLastRunCompileError",
    GetLastRunRunTimeError = "GetLastRunRunTimeError",
    Goto = "Goto",
    If = "If",
    In = "In",
    Invalid = "Invalid",
    Let = "Let",
    LineNum = "LineNum",
    Mod = "Mod",
    Next = "Next",
    Not = "Not",
    ObjFun = "ObjFun",
    Or = "Or",
    Pos = "Pos",
    Print = "Print",
    Return = "Return",
    Run = "Run",
    Step = "Step",
    Stop = "Stop",
    Sub = "Sub",
    Tab = "Tab",
    Then = "Then",
    Throw = "Throw",
    To = "To",
    True = "True",
    Try = "Try",
    Type = "Type",
    While = "While",
    Plus = "Plus",// +
    Minus = "Minus",// -
    Star = "Star",// *
    Slash = "Slash",// /
    Backslash = "Backslash",// \ (integer division)
    Caret = "Caret",// ^
    Equal = "Equal",// =
    LessGreater = "LessGreater",// <>
    Less = "Less",// <
    Greater = "Greater",// >
    LessEqual = "LessEqual",// <=
    GreaterEqual = "GreaterEqual",// >=
    LeftShift = "LeftShift",// <<
    RightShift = "RightShift",// >>
    PlusEqual = "PlusEqual",// +=
    MinusEqual = "MinusEqual",// -=
    StarEqual = "StarEqual",// *=
    SlashEqual = "SlashEqual",// /=
    BackslashEqual = "BackslashEqual",// \=
    LeftShiftEqual = "LeftShiftEqual",// <<=
    RightShiftEqual = "RightShiftEqual",// >>=
    PlusPlus = "PlusPlus",// ++
    MinusMinus = "MinusMinus",// --
    QuestionDot = "QuestionDot",// ?.
    QuestionBracket = "QuestionBracket",// ?[
    QuestionParen = "QuestionParen",// ?(
    QuestionAt = "QuestionAt",// ?@
    LeftParen = "LeftParen",// (
    RightParen = "RightParen",// )
    LeftBracket = "LeftBracket",// [
    RightBracket = "RightBracket",// ]
    LeftBrace = "LeftBrace",// {
    RightBrace = "RightBrace",// }
    Dot = "Dot",// .
    Comma = "Comma",// ,
    Colon = "Colon",// :
    Semicolon = "Semicolon",// ;
    At = "At",// @
    QuestionMark = "QuestionMark",// ? (print shorthand — only when standalone)
    HashIf = "HashIf",// #if
    HashElseIf = "HashElseIf",// #else if / #elseif
    HashElse = "HashElse",// #else
    HashEndIf = "HashEndIf",// #end if / #endif
    HashConst = "HashConst",// #const
    HashError = "HashError",// #error
    Eof = "Eof",// end of input
    Unknown = "Unknown"
}
/**
 * Map from lowercase keyword text → TokenKind.
 * Used by the lexer to classify identifiers as keywords.
 */
export declare const KEYWORD_MAP: Map<string, TokenKind>;
/** Returns true if the token kind is a keyword (not an identifier or literal). */
export declare function isKeyword(kind: TokenKind): boolean;
//# sourceMappingURL=tokenKind.d.ts.map