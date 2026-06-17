import { expect } from 'chai';
import { tokenize, TokenKind, TriviaKind, tokensToText } from '../src/index.js';
import type { Token, Trivia } from '../src/index.js';

/** Helper: tokenize and return only significant tokens (no EOF). */
function lex(source: string): Token[] {
  return tokenize(source).filter(t => t.kind !== TokenKind.Eof);
}

/** Helper: get token kinds from source (no EOF). */
function kinds(source: string): TokenKind[] {
  return lex(source).map(t => t.kind);
}

/** Helper: get token texts from source (no EOF). */
function texts(source: string): string[] {
  return lex(source).map(t => t.text);
}

describe('Lexer', () => {
  // ─── Round-trip fidelity ────────────────────────────────────────────────

  describe('round-trip fidelity', () => {
    const samples = [
      '',
      '   ',
      '\n',
      '\r\n',
      "' a comment",
      'x = 1',
      'if x > 0 then print "yes" else print "no"',
      "' @import /path/to/file from module-name\nsub main()\n  print \"hello\"\nend sub\n",
      'a = CreateObject("roUrlTransfer")\na.SetUrl("https://example.com")\n',
      'dim arr[5, 3]\nfor i = 0 to 5\n  for j = 0 to 3\n    arr[i, j] = i * j\n  end for\nend for\n',
      '#if DEBUG\n  print "debug mode"\n#else\n  print "release"\n#end if\n',
      'x = array?[3]?.foo?.bar?()\n',
      'a += 1 : b -= 2 : c *= 3\n',
      'function add(a as Integer, b=5 as Integer) as Integer\n  return a + b\nend function\n',
      'try\n  print 1/0\ncatch e\n  print e.message\nend try\n',
      'aa = { "key with spaces": 1, simple: 2 }\n',
      "s = \"she said \"\"hello\"\" to me\"\n",
      'x = &HFF\ny = 9876543210&\nz = 1.23456789D-12\nw = 2.01!\n',
      'rem this is a rem comment\nprint "hello" \' trailing\n',
    ];

    for (const src of samples) {
      it(`round-trips: ${JSON.stringify(src).slice(0, 60)}`, () => {
        const tokens = tokenize(src);
        const reconstructed = tokensToText(tokens);
        expect(reconstructed).to.equal(src);
      });
    }
  });

  // ─── Keywords ───────────────────────────────────────────────────────────

  describe('keywords', () => {
    const keywordTests: [string, TokenKind][] = [
      ['and', TokenKind.And],
      ['AND', TokenKind.And],
      ['as', TokenKind.As],
      ['box', TokenKind.Box],
      ['catch', TokenKind.Catch],
      ['continue', TokenKind.Continue],
      ['CreateObject', TokenKind.CreateObject],
      ['dim', TokenKind.Dim],
      ['each', TokenKind.Each],
      ['else', TokenKind.Else],
      ['elseif', TokenKind.ElseIf],
      ['ElseIf', TokenKind.ElseIf],
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
      ['FALSE', TokenKind.False],
      ['for', TokenKind.For],
      ['function', TokenKind.Function],
      ['Function', TokenKind.Function],
      ['getglobalaa', TokenKind.GetGlobalAA],
      ['goto', TokenKind.Goto],
      ['if', TokenKind.If],
      ['IF', TokenKind.If],
      ['in', TokenKind.In],
      ['invalid', TokenKind.Invalid],
      ['Invalid', TokenKind.Invalid],
      ['let', TokenKind.Let],
      ['line_num', TokenKind.LineNum],
      ['LINE_NUM', TokenKind.LineNum],
      ['mod', TokenKind.Mod],
      ['next', TokenKind.Next],
      ['not', TokenKind.Not],
      ['NOT', TokenKind.Not],
      ['or', TokenKind.Or],
      ['OR', TokenKind.Or],
      ['pos', TokenKind.Pos],
      ['print', TokenKind.Print],
      ['Print', TokenKind.Print],
      ['PRINT', TokenKind.Print],
      ['return', TokenKind.Return],
      ['Return', TokenKind.Return],
      ['run', TokenKind.Run],
      ['step', TokenKind.Step],
      ['stop', TokenKind.Stop],
      ['sub', TokenKind.Sub],
      ['Sub', TokenKind.Sub],
      ['tab', TokenKind.Tab],
      ['then', TokenKind.Then],
      ['Then', TokenKind.Then],
      ['throw', TokenKind.Throw],
      ['to', TokenKind.To],
      ['true', TokenKind.True],
      ['TRUE', TokenKind.True],
      ['try', TokenKind.Try],
      ['type', TokenKind.Type],
      ['while', TokenKind.While],
      ['While', TokenKind.While],
    ];

    for (const [text, expected] of keywordTests) {
      it(`"${text}" → ${expected}`, () => {
        const tokens = lex(text);
        expect(tokens).to.have.length(1);
        expect(tokens[0].kind).to.equal(expected);
        expect(tokens[0].text).to.equal(text);
      });
    }
  });

  // ─── Compound keywords ─────────────────────────────────────────────────

  describe('compound keywords', () => {
    const compounds: [string, TokenKind][] = [
      ['end if', TokenKind.EndIf],
      ['End If', TokenKind.EndIf],
      ['END IF', TokenKind.EndIf],
      ['end function', TokenKind.EndFunction],
      ['End Function', TokenKind.EndFunction],
      ['end sub', TokenKind.EndSub],
      ['End Sub', TokenKind.EndSub],
      ['end while', TokenKind.EndWhile],
      ['end for', TokenKind.EndFor],
      ['end try', TokenKind.EndTry],
      ['else if', TokenKind.ElseIf],
      ['Else If', TokenKind.ElseIf],
      ['exit while', TokenKind.ExitWhile],
    ];

    for (const [text, expected] of compounds) {
      it(`"${text}" → ${expected}`, () => {
        const tokens = lex(text);
        expect(tokens).to.have.length(1);
        expect(tokens[0].kind).to.equal(expected);
        expect(tokens[0].text).to.equal(text);
      });
    }

    it('"end" alone is just End', () => {
      const tokens = lex('end');
      expect(tokens).to.have.length(1);
      expect(tokens[0].kind).to.equal(TokenKind.End);
    });

    it('"exit" alone is just Exit', () => {
      const tokens = lex('exit');
      expect(tokens).to.have.length(1);
      expect(tokens[0].kind).to.equal(TokenKind.Exit);
    });

    it('"exit for" is two tokens (exit + for)', () => {
      const tokens = lex('exit for');
      expect(tokens).to.have.length(2);
      expect(tokens[0].kind).to.equal(TokenKind.Exit);
      expect(tokens[1].kind).to.equal(TokenKind.For);
    });

    it('"continue for" is two tokens (continue + for)', () => {
      const tokens = lex('continue for');
      expect(tokens).to.have.length(2);
      expect(tokens[0].kind).to.equal(TokenKind.Continue);
      expect(tokens[1].kind).to.equal(TokenKind.For);
    });
  });

  // ─── Identifiers ────────────────────────────────────────────────────────

  describe('identifiers', () => {
    it('simple identifier', () => {
      const [tok] = lex('myVariable');
      expect(tok.kind).to.equal(TokenKind.Identifier);
      expect(tok.text).to.equal('myVariable');
    });

    it('identifier starting with underscore', () => {
      const [tok] = lex('_private');
      expect(tok.kind).to.equal(TokenKind.Identifier);
    });

    it('identifier with digits', () => {
      const [tok] = lex('item2');
      expect(tok.kind).to.equal(TokenKind.Identifier);
    });

    it('typed identifier with $ (string)', () => {
      const [tok] = lex('name$');
      expect(tok.kind).to.equal(TokenKind.Identifier);
      expect(tok.text).to.equal('name$');
    });

    it('typed identifier with % (integer)', () => {
      const [tok] = lex('count%');
      expect(tok.kind).to.equal(TokenKind.Identifier);
      expect(tok.text).to.equal('count%');
    });

    it('typed identifier with ! (float)', () => {
      const [tok] = lex('value!');
      expect(tok.kind).to.equal(TokenKind.Identifier);
      expect(tok.text).to.equal('value!');
    });

    it('typed identifier with # (double)', () => {
      const [tok] = lex('distance#');
      expect(tok.kind).to.equal(TokenKind.Identifier);
      expect(tok.text).to.equal('distance#');
    });

    it('typed identifier with & (long integer)', () => {
      const [tok] = lex('bigId&');
      expect(tok.kind).to.equal(TokenKind.Identifier);
      expect(tok.text).to.equal('bigId&');
    });

    it('keyword-like identifier with type designator is not keyword', () => {
      const [tok] = lex('end$');
      expect(tok.kind).to.equal(TokenKind.Identifier);
    });
  });

  // ─── String literals ────────────────────────────────────────────────────

  describe('string literals', () => {
    it('simple string', () => {
      const [tok] = lex('"hello"');
      expect(tok.kind).to.equal(TokenKind.StringLiteral);
      expect(tok.text).to.equal('"hello"');
    });

    it('empty string', () => {
      const [tok] = lex('""');
      expect(tok.kind).to.equal(TokenKind.StringLiteral);
      expect(tok.text).to.equal('""');
    });

    it('string with escaped quote (doubled)', () => {
      const [tok] = lex('""""');
      expect(tok.kind).to.equal(TokenKind.StringLiteral);
      expect(tok.text).to.equal('""""');
    });

    it('string with embedded escaped quotes', () => {
      const [tok] = lex('"she said ""hello"" to me"');
      expect(tok.kind).to.equal(TokenKind.StringLiteral);
      expect(tok.text).to.equal('"she said ""hello"" to me"');
    });

    it('unterminated string stops at newline', () => {
      const tokens = lex('"unterminated\nprint 1');
      expect(tokens[0].kind).to.equal(TokenKind.StringLiteral);
      expect(tokens[0].text).to.equal('"unterminated');
    });
  });

  // ─── Numeric literals ──────────────────────────────────────────────────

  describe('numeric literals', () => {
    it('integer', () => {
      const [tok] = lex('255');
      expect(tok.kind).to.equal(TokenKind.IntegerLiteral);
      expect(tok.text).to.equal('255');
    });

    it('integer with % designator', () => {
      const [tok] = lex('125%');
      expect(tok.kind).to.equal(TokenKind.IntegerLiteral);
      expect(tok.text).to.equal('125%');
    });

    it('hex integer &HFF', () => {
      const [tok] = lex('&HFF');
      expect(tok.kind).to.equal(TokenKind.IntegerLiteral);
      expect(tok.text).to.equal('&HFF');
    });

    it('hex integer &hABCD', () => {
      const [tok] = lex('&hABCD');
      expect(tok.kind).to.equal(TokenKind.IntegerLiteral);
      expect(tok.text).to.equal('&hABCD');
    });

    it('long integer with & suffix', () => {
      const [tok] = lex('9876543210&');
      expect(tok.kind).to.equal(TokenKind.LongIntegerLiteral);
      expect(tok.text).to.equal('9876543210&');
    });

    it('hex long integer &hFEDCBA9876543210&', () => {
      const [tok] = lex('&hFEDCBA9876543210&');
      expect(tok.kind).to.equal(TokenKind.LongIntegerLiteral);
      expect(tok.text).to.equal('&hFEDCBA9876543210&');
    });

    it('float with decimal', () => {
      const [tok] = lex('2.01');
      expect(tok.kind).to.equal(TokenKind.FloatLiteral);
      expect(tok.text).to.equal('2.01');
    });

    it('float with E exponent', () => {
      const [tok] = lex('1.23456E+30');
      expect(tok.kind).to.equal(TokenKind.FloatLiteral);
    });

    it('float with ! designator', () => {
      const [tok] = lex('2!');
      expect(tok.kind).to.equal(TokenKind.FloatLiteral);
      expect(tok.text).to.equal('2!');
    });

    it('double with D exponent', () => {
      const [tok] = lex('1.23456789D-12');
      expect(tok.kind).to.equal(TokenKind.DoubleLiteral);
    });

    it('double with # designator', () => {
      const [tok] = lex('2.3#');
      expect(tok.kind).to.equal(TokenKind.DoubleLiteral);
      expect(tok.text).to.equal('2.3#');
    });

    it('number starting with decimal point', () => {
      const [tok] = lex('.5');
      expect(tok.kind).to.equal(TokenKind.FloatLiteral);
      expect(tok.text).to.equal('.5');
    });
  });

  // ─── Operators ──────────────────────────────────────────────────────────

  describe('operators', () => {
    const ops: [string, TokenKind][] = [
      ['+', TokenKind.Plus],
      ['-', TokenKind.Minus],
      ['*', TokenKind.Star],
      ['/', TokenKind.Slash],
      ['\\', TokenKind.Backslash],
      ['^', TokenKind.Caret],
      ['=', TokenKind.Equal],
      ['<>', TokenKind.LessGreater],
      ['<', TokenKind.Less],
      ['>', TokenKind.Greater],
      ['<=', TokenKind.LessEqual],
      ['>=', TokenKind.GreaterEqual],
      ['<<', TokenKind.LeftShift],
      ['>>', TokenKind.RightShift],
      ['+=', TokenKind.PlusEqual],
      ['-=', TokenKind.MinusEqual],
      ['*=', TokenKind.StarEqual],
      ['/=', TokenKind.SlashEqual],
      ['\\=', TokenKind.BackslashEqual],
      ['<<=', TokenKind.LeftShiftEqual],
      ['>>=', TokenKind.RightShiftEqual],
      ['++', TokenKind.PlusPlus],
      ['--', TokenKind.MinusMinus],
    ];

    for (const [text, expected] of ops) {
      it(`"${text}" → ${expected}`, () => {
        const tokens = lex(text);
        expect(tokens[0].kind).to.equal(expected);
        expect(tokens[0].text).to.equal(text);
      });
    }
  });

  // ─── Optional chaining ─────────────────────────────────────────────────

  describe('optional chaining operators', () => {
    it('?. (QuestionDot)', () => {
      const tokens = lex('a?.b');
      expect(tokens[0].kind).to.equal(TokenKind.Identifier);
      expect(tokens[1].kind).to.equal(TokenKind.QuestionDot);
      expect(tokens[2].kind).to.equal(TokenKind.Identifier);
    });

    it('?[ (QuestionBracket)', () => {
      const tokens = lex('a?[0]');
      expect(tokens[1].kind).to.equal(TokenKind.QuestionBracket);
    });

    it('?( (QuestionParen)', () => {
      const tokens = lex('f?()');
      expect(tokens[1].kind).to.equal(TokenKind.QuestionParen);
    });

    it('?@ (QuestionAt)', () => {
      const tokens = lex('a?@attr');
      expect(tokens[1].kind).to.equal(TokenKind.QuestionAt);
    });

    it('standalone ? is QuestionMark (print)', () => {
      const tokens = lex('? "hello"');
      expect(tokens[0].kind).to.equal(TokenKind.QuestionMark);
    });
  });

  // ─── Punctuation ────────────────────────────────────────────────────────

  describe('punctuation', () => {
    const puncs: [string, TokenKind][] = [
      ['(', TokenKind.LeftParen],
      [')', TokenKind.RightParen],
      ['[', TokenKind.LeftBracket],
      [']', TokenKind.RightBracket],
      ['{', TokenKind.LeftBrace],
      ['}', TokenKind.RightBrace],
      ['.', TokenKind.Dot],
      [',', TokenKind.Comma],
      [':', TokenKind.Colon],
      [';', TokenKind.Semicolon],
      ['@', TokenKind.At],
    ];

    for (const [text, expected] of puncs) {
      it(`"${text}" → ${expected}`, () => {
        const [tok] = lex(text);
        expect(tok.kind).to.equal(expected);
      });
    }
  });

  // ─── Conditional compilation ────────────────────────────────────────────

  describe('conditional compilation', () => {
    it('#if', () => {
      const [tok] = lex('#if');
      expect(tok.kind).to.equal(TokenKind.HashIf);
    });

    it('#else', () => {
      const [tok] = lex('#else');
      expect(tok.kind).to.equal(TokenKind.HashElse);
    });

    it('#else if', () => {
      const [tok] = lex('#else if');
      expect(tok.kind).to.equal(TokenKind.HashElseIf);
    });

    it('#elseif', () => {
      const [tok] = lex('#elseif');
      expect(tok.kind).to.equal(TokenKind.HashElseIf);
    });

    it('#end if', () => {
      const [tok] = lex('#end if');
      expect(tok.kind).to.equal(TokenKind.HashEndIf);
    });

    it('#endif', () => {
      const [tok] = lex('#endif');
      expect(tok.kind).to.equal(TokenKind.HashEndIf);
    });

    it('#const', () => {
      const [tok] = lex('#const');
      expect(tok.kind).to.equal(TokenKind.HashConst);
    });

    it('#error captures message to end of line', () => {
      const tokens = lex('#error TODO: implement feature A');
      expect(tokens[0].kind).to.equal(TokenKind.HashError);
      expect(tokens[0].text).to.equal('#error TODO: implement feature A');
    });
  });

  // ─── Trivia ─────────────────────────────────────────────────────────────

  describe('trivia', () => {
    it('leading whitespace', () => {
      const tokens = lex('  x');
      expect(tokens[0].leadingTrivia).to.have.length(1);
      expect(tokens[0].leadingTrivia[0].kind).to.equal(TriviaKind.Whitespace);
      expect(tokens[0].leadingTrivia[0].text).to.equal('  ');
    });

    it('trailing comment', () => {
      const src = "x = 1 ' comment\n";
      const tokens = lex(src);
      const xToken = tokens[0];
      // x should have no trailing trivia — the space is leading trivia of =
      const lastSignificant = tokens[tokens.length - 1]; // 1
      // The trailing comment and newline are on the last token
      expect(lastSignificant.trailingTrivia.length).to.be.greaterThan(0);
    });

    it('tick comment as leading trivia', () => {
      const src = "' this is a comment\nprint 1";
      const tokens = lex(src);
      // The comment + newline are leading trivia of `print`
      const printToken = tokens.find(t => t.kind === TokenKind.Print);
      expect(printToken).to.exist;
      const commentTrivia = printToken!.leadingTrivia.find(t => t.kind === TriviaKind.Comment);
      expect(commentTrivia).to.exist;
      expect(commentTrivia!.text).to.equal("' this is a comment");
    });

    it('rem comment as leading trivia', () => {
      const src = 'rem this is a rem comment\nprint 1';
      const tokens = lex(src);
      const printToken = tokens.find(t => t.kind === TokenKind.Print);
      expect(printToken).to.exist;
      const remTrivia = printToken!.leadingTrivia.find(t => t.kind === TriviaKind.RemComment);
      expect(remTrivia).to.exist;
      expect(remTrivia!.text).to.equal('rem this is a rem comment');
    });

    it('rem inside identifier is not a comment', () => {
      const [tok] = lex('remember');
      expect(tok.kind).to.equal(TokenKind.Identifier);
      expect(tok.text).to.equal('remember');
    });

    it('CRLF line breaks', () => {
      const src = 'a\r\nb';
      const tokens = lex(src);
      expect(tokensToText(tokenize(src))).to.equal(src);
    });

    it('multiple blank lines preserved', () => {
      const src = 'a\n\n\nb';
      expect(tokensToText(tokenize(src))).to.equal(src);
    });
  });

  // ─── Position tracking ──────────────────────────────────────────────────

  describe('position tracking', () => {
    it('first token is at line 0, column 0', () => {
      const [tok] = lex('x');
      expect(tok.line).to.equal(0);
      expect(tok.column).to.equal(0);
    });

    it('indented token has correct column', () => {
      const [tok] = lex('    x');
      expect(tok.line).to.equal(0);
      expect(tok.column).to.equal(4);
    });

    it('second line token has correct line number', () => {
      const tokens = lex('a\nb');
      const b = tokens.find(t => t.text === 'b');
      expect(b).to.exist;
      expect(b!.line).to.equal(1);
      expect(b!.column).to.equal(0);
    });

    it('pos and end are byte offsets', () => {
      const tokens = lex('ab cd');
      expect(tokens[0].pos).to.equal(0);
      expect(tokens[0].end).to.equal(2);
      expect(tokens[1].pos).to.equal(3);
      expect(tokens[1].end).to.equal(5);
    });
  });

  // ─── EOF ────────────────────────────────────────────────────────────────

  describe('EOF', () => {
    it('empty source produces only EOF', () => {
      const tokens = tokenize('');
      expect(tokens).to.have.length(1);
      expect(tokens[0].kind).to.equal(TokenKind.Eof);
    });

    it('last token is always EOF', () => {
      const tokens = tokenize('x = 1');
      expect(tokens[tokens.length - 1].kind).to.equal(TokenKind.Eof);
    });

    it('trailing whitespace-only source attaches to EOF', () => {
      const tokens = tokenize('   ');
      expect(tokens).to.have.length(1);
      expect(tokens[0].kind).to.equal(TokenKind.Eof);
      expect(tokens[0].leadingTrivia).to.have.length(1);
    });
  });

  // ─── Complex expressions (from Roku docs) ──────────────────────────────

  describe('complex expressions from Roku docs', () => {
    it('assignment with CreateObject', () => {
      const tokens = lex('i = CreateObject("roInt")');
      expect(kinds('i = CreateObject("roInt")')).to.deep.equal([
        TokenKind.Identifier, TokenKind.Equal, TokenKind.CreateObject,
        TokenKind.LeftParen, TokenKind.StringLiteral, TokenKind.RightParen,
      ]);
    });

    it('for loop', () => {
      const src = 'for i = 10 to 1 step -1';
      const k = kinds(src);
      expect(k).to.deep.equal([
        TokenKind.For, TokenKind.Identifier, TokenKind.Equal,
        TokenKind.IntegerLiteral, TokenKind.To, TokenKind.IntegerLiteral,
        TokenKind.Step, TokenKind.Minus, TokenKind.IntegerLiteral,
      ]);
    });

    it('for each', () => {
      const k = kinds('for each n in aa');
      expect(k).to.deep.equal([
        TokenKind.For, TokenKind.Each, TokenKind.Identifier,
        TokenKind.In, TokenKind.Identifier,
      ]);
    });

    it('function declaration with typed params', () => {
      const src = 'function add(a as Integer, b as Integer) as Integer';
      const k = kinds(src);
      expect(k[0]).to.equal(TokenKind.Function);
      expect(k[1]).to.equal(TokenKind.Identifier); // add
      expect(k[2]).to.equal(TokenKind.LeftParen);
    });

    it('AA literal with quoted keys', () => {
      const src = '{ "Jane Doe": 1001, "John Doe": 1002 }';
      const k = kinds(src);
      expect(k[0]).to.equal(TokenKind.LeftBrace);
      expect(k[1]).to.equal(TokenKind.StringLiteral);
      expect(k[2]).to.equal(TokenKind.Colon);
    });

    it('optional chaining chain', () => {
      const src = 'x = array?[3]?.foo?.bar?()';
      const tokens = lex(src);
      const k = tokens.map(t => t.kind);
      expect(k).to.include(TokenKind.QuestionBracket);
      expect(k).to.include(TokenKind.QuestionDot);
      expect(k).to.include(TokenKind.QuestionParen);
    });

    it('dim multi-dimensional', () => {
      const k = kinds('dim c[5, 4, 6]');
      expect(k[0]).to.equal(TokenKind.Dim);
      expect(k[1]).to.equal(TokenKind.Identifier); // c
      expect(k[2]).to.equal(TokenKind.LeftBracket);
    });

    it('try/catch/end try', () => {
      const src = 'try\n  print 1/0\ncatch e\n  print e.message\nend try';
      const tokens = lex(src);
      expect(tokens[0].kind).to.equal(TokenKind.Try);
      const catchToken = tokens.find(t => t.kind === TokenKind.Catch);
      expect(catchToken).to.exist;
      const endTryToken = tokens.find(t => t.kind === TokenKind.EndTry);
      expect(endTryToken).to.exist;
    });

    it('colon statement separator', () => {
      const k = kinds('a = 1 : b = 2');
      expect(k).to.deep.equal([
        TokenKind.Identifier, TokenKind.Equal, TokenKind.IntegerLiteral,
        TokenKind.Colon,
        TokenKind.Identifier, TokenKind.Equal, TokenKind.IntegerLiteral,
      ]);
    });

    it('compound assignment operators', () => {
      expect(kinds('a += 1')[1]).to.equal(TokenKind.PlusEqual);
      expect(kinds('a -= 1')[1]).to.equal(TokenKind.MinusEqual);
      expect(kinds('a *= 1')[1]).to.equal(TokenKind.StarEqual);
      expect(kinds('a /= 1')[1]).to.equal(TokenKind.SlashEqual);
      expect(kinds('a \\= 1')[1]).to.equal(TokenKind.BackslashEqual);
      expect(kinds('a <<= 1')[1]).to.equal(TokenKind.LeftShiftEqual);
      expect(kinds('a >>= 1')[1]).to.equal(TokenKind.RightShiftEqual);
    });

    it('increment and decrement', () => {
      expect(kinds('i++')[1]).to.equal(TokenKind.PlusPlus);
      expect(kinds('i--')[1]).to.equal(TokenKind.MinusMinus);
    });

    it('dot operator on object', () => {
      const k = kinds('i.SetInt(5)');
      expect(k).to.deep.equal([
        TokenKind.Identifier, TokenKind.Dot, TokenKind.Identifier,
        TokenKind.LeftParen, TokenKind.IntegerLiteral, TokenKind.RightParen,
      ]);
    });

    it('@import annotation in comment', () => {
      const src = "' @import /path/to/file from module-name";
      const tokens = tokenize(src);
      // The entire line is a comment trivia on the EOF token
      expect(tokens).to.have.length(1);
      expect(tokens[0].kind).to.equal(TokenKind.Eof);
      expect(tokens[0].leadingTrivia[0].kind).to.equal(TriviaKind.Comment);
      expect(tokens[0].leadingTrivia[0].text).to.contain('@import');
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('unknown character produces Unknown token', () => {
      const [tok] = lex('~');
      expect(tok.kind).to.equal(TokenKind.Unknown);
    });

    it('dot followed by identifier is Dot + Identifier', () => {
      const k = kinds('.foo');
      expect(k).to.deep.equal([TokenKind.Dot, TokenKind.Identifier]);
    });

    it('dot followed by digit is a float literal', () => {
      const [tok] = lex('.5');
      expect(tok.kind).to.equal(TokenKind.FloatLiteral);
    });

    it('"endif" is one token, "end if" is one token', () => {
      expect(lex('endif')).to.have.length(1);
      expect(lex('end if')).to.have.length(1);
      expect(lex('endif')[0].kind).to.equal(TokenKind.EndIf);
      expect(lex('end if')[0].kind).to.equal(TokenKind.EndIf);
    });

    it('rem at start of line is comment', () => {
      const tokens = lex('rem this is a comment\nx = 1');
      // rem comment is trivia, so first significant token is x
      expect(tokens[0].kind).to.equal(TokenKind.Identifier);
      expect(tokens[0].text).to.equal('x');
    });

    it('rem after colon is comment', () => {
      const src = 'x = 1 : rem comment';
      const tokens = lex(src);
      // rem should be trailing trivia of some token
      expect(tokensToText(tokenize(src))).to.equal(src);
    });

    it('empty lines between statements', () => {
      const src = 'a = 1\n\n\nb = 2';
      const tokens = lex(src);
      expect(tokensToText(tokenize(src))).to.equal(src);
    });

    it('mixed operators without spaces', () => {
      const src = 'a+b*c-d/e';
      const k = kinds(src);
      expect(k).to.deep.equal([
        TokenKind.Identifier, TokenKind.Plus, TokenKind.Identifier,
        TokenKind.Star, TokenKind.Identifier, TokenKind.Minus,
        TokenKind.Identifier, TokenKind.Slash, TokenKind.Identifier,
      ]);
    });

    it('negative hex literal', () => {
      // -&HFF is two tokens: Minus + IntegerLiteral
      const k = kinds('-&HFF');
      expect(k).to.deep.equal([TokenKind.Minus, TokenKind.IntegerLiteral]);
    });

    it('? at end of line is print shorthand', () => {
      const tokens = lex('?');
      expect(tokens[0].kind).to.equal(TokenKind.QuestionMark);
    });

    it('single-line if with then', () => {
      const src = 'if x > 0 then print "yes"';
      const k = kinds(src);
      expect(k[0]).to.equal(TokenKind.If);
      expect(k).to.include(TokenKind.Then);
      expect(k).to.include(TokenKind.Print);
    });
  });
});
