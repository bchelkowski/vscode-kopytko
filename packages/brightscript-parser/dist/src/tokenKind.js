"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEYWORD_MAP = exports.TokenKind = void 0;
exports.isKeyword = isKeyword;
/**
 * Every token kind that the BrightScript lexer can produce.
 *
 * Derived from the official Roku documentation:
 * - Reserved words: https://developer.roku.com/dev/docs/reserved-words
 * - Operators:      https://developer.roku.com/dev/docs/expressions-variables-types
 * - Statements:     https://developer.roku.com/dev/docs/program-statements
 * - Conditionals:   https://developer.roku.com/dev/docs/conditional-compilation
 */
var TokenKind;
(function (TokenKind) {
    // ── Literals ────────────────────────────────────────────────────────────
    TokenKind["IntegerLiteral"] = "IntegerLiteral";
    TokenKind["LongIntegerLiteral"] = "LongIntegerLiteral";
    TokenKind["FloatLiteral"] = "FloatLiteral";
    TokenKind["DoubleLiteral"] = "DoubleLiteral";
    TokenKind["StringLiteral"] = "StringLiteral";
    // ── Identifiers ─────────────────────────────────────────────────────────
    TokenKind["Identifier"] = "Identifier";
    // ── Reserved words / keywords ───────────────────────────────────────────
    // From https://developer.roku.com/dev/docs/reserved-words
    TokenKind["And"] = "And";
    TokenKind["As"] = "As";
    TokenKind["Box"] = "Box";
    TokenKind["Catch"] = "Catch";
    TokenKind["Continue"] = "Continue";
    TokenKind["CreateObject"] = "CreateObject";
    TokenKind["Dim"] = "Dim";
    TokenKind["Each"] = "Each";
    TokenKind["Else"] = "Else";
    TokenKind["ElseIf"] = "ElseIf";
    TokenKind["End"] = "End";
    TokenKind["EndFor"] = "EndFor";
    TokenKind["EndFunction"] = "EndFunction";
    TokenKind["EndIf"] = "EndIf";
    TokenKind["EndSub"] = "EndSub";
    TokenKind["EndWhile"] = "EndWhile";
    TokenKind["EndTry"] = "EndTry";
    TokenKind["Eval"] = "Eval";
    TokenKind["Exit"] = "Exit";
    TokenKind["ExitWhile"] = "ExitWhile";
    TokenKind["False"] = "False";
    TokenKind["For"] = "For";
    TokenKind["Function"] = "Function";
    TokenKind["GetGlobalAA"] = "GetGlobalAA";
    TokenKind["GetLastRunCompileError"] = "GetLastRunCompileError";
    TokenKind["GetLastRunRunTimeError"] = "GetLastRunRunTimeError";
    TokenKind["Goto"] = "Goto";
    TokenKind["If"] = "If";
    TokenKind["In"] = "In";
    TokenKind["Invalid"] = "Invalid";
    TokenKind["Let"] = "Let";
    TokenKind["LineNum"] = "LineNum";
    TokenKind["Mod"] = "Mod";
    TokenKind["Next"] = "Next";
    TokenKind["Not"] = "Not";
    TokenKind["ObjFun"] = "ObjFun";
    TokenKind["Or"] = "Or";
    TokenKind["Pos"] = "Pos";
    TokenKind["Print"] = "Print";
    TokenKind["Return"] = "Return";
    TokenKind["Run"] = "Run";
    TokenKind["Step"] = "Step";
    TokenKind["Stop"] = "Stop";
    TokenKind["Sub"] = "Sub";
    TokenKind["Tab"] = "Tab";
    TokenKind["Then"] = "Then";
    TokenKind["Throw"] = "Throw";
    TokenKind["To"] = "To";
    TokenKind["True"] = "True";
    TokenKind["Try"] = "Try";
    TokenKind["Type"] = "Type";
    TokenKind["While"] = "While";
    // ── Operators ───────────────────────────────────────────────────────────
    // Arithmetic
    TokenKind["Plus"] = "Plus";
    TokenKind["Minus"] = "Minus";
    TokenKind["Star"] = "Star";
    TokenKind["Slash"] = "Slash";
    TokenKind["Backslash"] = "Backslash";
    TokenKind["Caret"] = "Caret";
    // Comparison
    TokenKind["Equal"] = "Equal";
    TokenKind["LessGreater"] = "LessGreater";
    TokenKind["Less"] = "Less";
    TokenKind["Greater"] = "Greater";
    TokenKind["LessEqual"] = "LessEqual";
    TokenKind["GreaterEqual"] = "GreaterEqual";
    // Bitshift
    TokenKind["LeftShift"] = "LeftShift";
    TokenKind["RightShift"] = "RightShift";
    // Compound assignment
    TokenKind["PlusEqual"] = "PlusEqual";
    TokenKind["MinusEqual"] = "MinusEqual";
    TokenKind["StarEqual"] = "StarEqual";
    TokenKind["SlashEqual"] = "SlashEqual";
    TokenKind["BackslashEqual"] = "BackslashEqual";
    TokenKind["LeftShiftEqual"] = "LeftShiftEqual";
    TokenKind["RightShiftEqual"] = "RightShiftEqual";
    // Increment / decrement
    TokenKind["PlusPlus"] = "PlusPlus";
    TokenKind["MinusMinus"] = "MinusMinus";
    // ── Optional chaining (Roku OS 11.0+) ──────────────────────────────────
    TokenKind["QuestionDot"] = "QuestionDot";
    TokenKind["QuestionBracket"] = "QuestionBracket";
    TokenKind["QuestionParen"] = "QuestionParen";
    TokenKind["QuestionAt"] = "QuestionAt";
    // ── Punctuation ─────────────────────────────────────────────────────────
    TokenKind["LeftParen"] = "LeftParen";
    TokenKind["RightParen"] = "RightParen";
    TokenKind["LeftBracket"] = "LeftBracket";
    TokenKind["RightBracket"] = "RightBracket";
    TokenKind["LeftBrace"] = "LeftBrace";
    TokenKind["RightBrace"] = "RightBrace";
    TokenKind["Dot"] = "Dot";
    TokenKind["Comma"] = "Comma";
    TokenKind["Colon"] = "Colon";
    TokenKind["Semicolon"] = "Semicolon";
    TokenKind["At"] = "At";
    TokenKind["QuestionMark"] = "QuestionMark";
    // ── Conditional compilation ─────────────────────────────────────────────
    TokenKind["HashIf"] = "HashIf";
    TokenKind["HashElseIf"] = "HashElseIf";
    TokenKind["HashElse"] = "HashElse";
    TokenKind["HashEndIf"] = "HashEndIf";
    TokenKind["HashConst"] = "HashConst";
    TokenKind["HashError"] = "HashError";
    // ── Special ─────────────────────────────────────────────────────────────
    TokenKind["Eof"] = "Eof";
    // Error recovery
    TokenKind["Unknown"] = "Unknown";
})(TokenKind || (exports.TokenKind = TokenKind = {}));
/**
 * Map from lowercase keyword text → TokenKind.
 * Used by the lexer to classify identifiers as keywords.
 */
exports.KEYWORD_MAP = new Map([
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
/** Returns true if the token kind is a keyword (not an identifier or literal). */
function isKeyword(kind) {
    for (const v of exports.KEYWORD_MAP.values()) {
        if (v === kind)
            return true;
    }
    return false;
}
//# sourceMappingURL=tokenKind.js.map