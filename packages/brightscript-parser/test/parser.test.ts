import { expect } from 'chai';
import { parse, SyntaxKind, TokenKind, SyntaxNode, isNode, isToken } from '../src/index.js';
import type { ParseResult, SyntaxChild } from '../src/index.js';

/** Parses source and asserts zero diagnostics. */
function parseOk(source: string): ParseResult {
  const result = parse(source);
  if (result.diagnostics.length > 0) {
    const msgs = result.diagnostics.map(d => `  L${d.line}:${d.column} ${d.message}`).join('\n');
    expect.fail(`Expected no parse errors but got:\n${msgs}\n\nSource: ${JSON.stringify(source)}`);
  }
  return result;
}

/** Gets the first child node of a specific kind from the root. */
function firstStatement(result: ParseResult): SyntaxNode {
  const stmts = result.root.childNodes;
  expect(stmts.length).to.be.greaterThan(0, 'Expected at least one statement');
  return stmts[0];
}

/** Gets all statement nodes from root (filtering out tokens like newlines). */
function statements(result: ParseResult): SyntaxNode[] {
  return result.root.childNodes;
}

describe('Parser', () => {
  // ─── Round-trip fidelity ────────────────────────────────────────────────

  describe('round-trip fidelity', () => {
    const samples = [
      'x = 1',
      'x = 1\ny = 2',
      'print "hello"',
      'if x > 0 then print "yes"',
      'if x > 0 then print "yes" else print "no"',
      'function five() as Integer\n  return 5\nend function',
      'sub main()\n  print "hello"\nend sub',
      'for i = 1 to 10\n  print i\nend for',
      'for each item in list\n  print item\nend for',
      'while x > 0\n  x = x - 1\nend while',
      'try\n  print 1/0\ncatch e\n  print e.message\nend try',
      'dim arr[5, 3]',
      'goto myLabel',
      'stop',
      'end',
      'return 42',
      'return',
      'throw "error"',
      'exit for',
      'exit while',
      'continue for',
      'continue while',
      'a = [1, 2, 3]',
      'a = { key: "value", num: 42 }',
      'x = a + b * c - d / e',
      'x = not y and z or w',
      'x = a?.b?[0]?()',
      'a += 1',
      'i++',
      'i--',
      '? "hello"',
      '#if DEBUG\n  print "debug"\n#end if',
      '#const FLAG = true',
      '#error TODO: implement this',
      'a = 1 : b = 2 : c = 3',
      'if x then y = 1 else y = 2',
      "' comment\nprint 1",
      'function add(a as Integer, b=5 as Integer) as Integer\n  return a + b\nend function',
      'aa = {\n  key1: "value"\n  key2: 42\n}',
      'arr = [\n  1\n  2\n  3\n]',
      'x = (a + b) * c',
      'x = 2 ^ 3 ^ 2',
      'print tab(5) "hello"',
      'print a; b, c',
      'x = CreateObject("roUrlTransfer")',
      'a.b.c(d, e)',
      'if x > 0\n  if y > 0\n    print "both positive"\n  end if\nend if',
      'for i = 1 to 10\n  for j = 1 to 10\n    print i * j\n  end for\nend for',
      'sub foo(a, b)\n  m.result = a + b\nend sub',
      'myLabel:\ngoto myLabel',
      'obj = {\n  add: function(a, b)\n    return a + b\n  end function\n}',
    ];

    for (const src of samples) {
      it(`round-trips: ${JSON.stringify(src).slice(0, 70)}`, () => {
        const result = parse(src);
        expect(result.root.getText()).to.equal(src);
      });
    }
  });

  // ─── Function / Sub declarations ────────────────────────────────────────

  describe('function declarations', () => {
    it('parses named function with return type', () => {
      const r = parseOk('function five() as Integer\n  return 5\nend function');
      const fn = firstStatement(r);
      expect(fn.kind).to.equal(SyntaxKind.FunctionDeclaration);
      expect(fn.findToken(TokenKind.Function)).to.exist;
      expect(fn.findChild(SyntaxKind.ParameterList)).to.exist;
      expect(fn.findChild(SyntaxKind.ReturnTypeClause)).to.exist;
    });

    it('parses sub with parameters', () => {
      const r = parseOk('sub main(args as Object)\n  print args\nend sub');
      const fn = firstStatement(r);
      expect(fn.kind).to.equal(SyntaxKind.FunctionDeclaration);
      const params = fn.findChild(SyntaxKind.ParameterList);
      expect(params).to.exist;
      expect(params!.findAllChildren(SyntaxKind.Parameter)).to.have.length(1);
    });

    it('parses function with default param value', () => {
      const r = parseOk('function add(a as Integer, b=5 as Integer) as Integer\n  return a + b\nend function');
      const fn = firstStatement(r);
      const params = fn.findChild(SyntaxKind.ParameterList);
      const paramNodes = params!.findAllChildren(SyntaxKind.Parameter);
      expect(paramNodes).to.have.length(2);
    });

    it('parses function with no params', () => {
      const r = parseOk('function foo()\n  return 1\nend function');
      const fn = firstStatement(r);
      expect(fn.kind).to.equal(SyntaxKind.FunctionDeclaration);
    });

    it('parses anonymous function expression in assignment', () => {
      const r = parseOk('myfunc = function(a, b)\n  return a + b\nend function');
      const stmt = firstStatement(r);
      expect(stmt.kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses sub with void body', () => {
      const r = parseOk('sub doNothing()\nend sub');
      const fn = firstStatement(r);
      expect(fn.kind).to.equal(SyntaxKind.FunctionDeclaration);
    });
  });

  // ─── If statements ──────────────────────────────────────────────────────

  describe('if statements', () => {
    it('parses multi-line if/end if', () => {
      const r = parseOk('if x > 0\n  print "positive"\nend if');
      const ifStmt = firstStatement(r);
      expect(ifStmt.kind).to.equal(SyntaxKind.IfStatement);
    });

    it('parses if/then/end if', () => {
      const r = parseOk('if x > 0 then\n  print "positive"\nend if');
      const ifStmt = firstStatement(r);
      expect(ifStmt.kind).to.equal(SyntaxKind.IfStatement);
      expect(ifStmt.findToken(TokenKind.Then)).to.exist;
    });

    it('parses if/else if/else/end if', () => {
      const r = parseOk('if x > 0\n  print "pos"\nelse if x < 0\n  print "neg"\nelse\n  print "zero"\nend if');
      const ifStmt = firstStatement(r);
      expect(ifStmt.kind).to.equal(SyntaxKind.IfStatement);
      expect(ifStmt.findAllChildren(SyntaxKind.ElseIfClause)).to.have.length(1);
      expect(ifStmt.findChild(SyntaxKind.ElseClause)).to.exist;
    });

    it('parses single-line if then', () => {
      const r = parseOk('if x > 0 then print "yes"');
      const ifStmt = firstStatement(r);
      expect(ifStmt.kind).to.equal(SyntaxKind.IfStatement);
    });

    it('parses single-line if then else', () => {
      const r = parseOk('if x then y = 1 else y = 2');
      const ifStmt = firstStatement(r);
      expect(ifStmt.kind).to.equal(SyntaxKind.IfStatement);
      expect(ifStmt.findChild(SyntaxKind.ElseClause)).to.exist;
    });

    it('parses nested if', () => {
      const r = parseOk('if a\n  if b\n    print "both"\n  end if\nend if');
      const outer = firstStatement(r);
      expect(outer.kind).to.equal(SyntaxKind.IfStatement);
    });

    it('parses elseif (single word)', () => {
      const r = parseOk('if a\n  print 1\nelseif b\n  print 2\nend if');
      const ifStmt = firstStatement(r);
      expect(ifStmt.findAllChildren(SyntaxKind.ElseIfClause)).to.have.length(1);
    });
  });

  // ─── For / For Each ─────────────────────────────────────────────────────

  describe('for statements', () => {
    it('parses basic for loop', () => {
      const r = parseOk('for i = 1 to 10\n  print i\nend for');
      const forStmt = firstStatement(r);
      expect(forStmt.kind).to.equal(SyntaxKind.ForStatement);
    });

    it('parses for loop with step', () => {
      const r = parseOk('for i = 10 to 1 step -1\n  print i\nend for');
      const forStmt = firstStatement(r);
      expect(forStmt.kind).to.equal(SyntaxKind.ForStatement);
      expect(forStmt.findToken(TokenKind.Step)).to.exist;
    });

    it('parses for loop with next', () => {
      const r = parseOk('for i = 1 to 10\n  print i\nnext');
      const forStmt = firstStatement(r);
      expect(forStmt.kind).to.equal(SyntaxKind.ForStatement);
    });

    it('parses for each', () => {
      const r = parseOk('for each item in list\n  print item\nend for');
      const forEach = firstStatement(r);
      expect(forEach.kind).to.equal(SyntaxKind.ForEachStatement);
    });

    it('parses nested for loops', () => {
      const r = parseOk('for i = 1 to 3\n  for j = 1 to 3\n    print i * j\n  end for\nend for');
      const outer = firstStatement(r);
      expect(outer.kind).to.equal(SyntaxKind.ForStatement);
    });
  });

  // ─── While ──────────────────────────────────────────────────────────────

  describe('while statements', () => {
    it('parses while loop', () => {
      const r = parseOk('while x > 0\n  x = x - 1\nend while');
      const w = firstStatement(r);
      expect(w.kind).to.equal(SyntaxKind.WhileStatement);
    });

    it('parses while true', () => {
      const r = parseOk('while true\n  print "loop"\n  exit while\nend while');
      const w = firstStatement(r);
      expect(w.kind).to.equal(SyntaxKind.WhileStatement);
    });
  });

  // ─── Try / Catch ────────────────────────────────────────────────────────

  describe('try/catch statements', () => {
    it('parses try/catch/end try', () => {
      const r = parseOk('try\n  print 1/0\ncatch e\n  print e.message\nend try');
      const tryStmt = firstStatement(r);
      expect(tryStmt.kind).to.equal(SyntaxKind.TryStatement);
      expect(tryStmt.findChild(SyntaxKind.CatchClause)).to.exist;
    });

    it('parses nested try/catch', () => {
      const r = parseOk('try\n  try\n    print 1\n  catch e\n    print 2\n  end try\ncatch e\n  print 3\nend try');
      const outer = firstStatement(r);
      expect(outer.kind).to.equal(SyntaxKind.TryStatement);
    });
  });

  // ─── Simple statements ──────────────────────────────────────────────────

  describe('simple statements', () => {
    it('parses return with value', () => {
      const r = parseOk('return 42');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ReturnStatement);
    });

    it('parses return without value', () => {
      const r = parseOk('return');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ReturnStatement);
    });

    it('parses print', () => {
      const r = parseOk('print "hello"');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.PrintStatement);
    });

    it('parses ? (print shorthand)', () => {
      const r = parseOk('? "hello"');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.PrintStatement);
    });

    it('parses print with separators', () => {
      const r = parseOk('print a; b, c');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.PrintStatement);
    });

    it('parses throw', () => {
      const r = parseOk('throw "error message"');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ThrowStatement);
    });

    it('parses dim', () => {
      const r = parseOk('dim arr[5, 3]');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.DimStatement);
    });

    it('parses stop', () => {
      const r = parseOk('stop');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.StopStatement);
    });

    it('parses end', () => {
      const r = parseOk('end');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.EndStatement);
    });

    it('parses goto', () => {
      const r = parseOk('goto myLabel');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.GotoStatement);
    });

    it('parses label', () => {
      const r = parseOk('myLabel:');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.LabelStatement);
    });

    it('parses exit for', () => {
      const r = parseOk('exit for');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ExitForStatement);
    });

    it('parses exit while', () => {
      const r = parseOk('exit while');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ExitWhileStatement);
    });

    it('parses continue for', () => {
      const r = parseOk('continue for');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ContinueForStatement);
    });

    it('parses continue while', () => {
      const r = parseOk('continue while');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ContinueWhileStatement);
    });
  });

  // ─── Assignments ────────────────────────────────────────────────────────

  describe('assignments', () => {
    it('parses simple assignment', () => {
      const r = parseOk('x = 1');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses compound assignment +=', () => {
      const r = parseOk('x += 1');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses dot assignment', () => {
      const r = parseOk('m.result = 42');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses index assignment', () => {
      const r = parseOk('arr[0] = "value"');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses increment', () => {
      const r = parseOk('i++');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ExpressionStatement);
    });

    it('parses multiple assignments with colon separator', () => {
      const r = parseOk('a = 1 : b = 2 : c = 3');
      const stmts = statements(r);
      expect(stmts.length).to.equal(3);
      expect(stmts[0].kind).to.equal(SyntaxKind.AssignmentStatement);
      expect(stmts[1].kind).to.equal(SyntaxKind.AssignmentStatement);
      expect(stmts[2].kind).to.equal(SyntaxKind.AssignmentStatement);
    });
  });

  // ─── Expressions ────────────────────────────────────────────────────────

  describe('expressions', () => {
    it('parses binary arithmetic', () => {
      const r = parseOk('x = a + b * c');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses logical operators', () => {
      const r = parseOk('x = a and b or c');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses not operator', () => {
      const r = parseOk('x = not y');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses comparison', () => {
      const r = parseOk('x = a > b');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses grouping', () => {
      const r = parseOk('x = (a + b) * c');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses exponentiation (right-associative)', () => {
      const r = parseOk('x = 2 ^ 3 ^ 2');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses unary minus', () => {
      const r = parseOk('x = -5');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses string concatenation', () => {
      const r = parseOk('x = "hello" + " " + "world"');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses dot access chain', () => {
      const r = parseOk('x = a.b.c');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses index access', () => {
      const r = parseOk('x = arr[0]');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses multi-dimensional index', () => {
      const r = parseOk('x = arr[1, 2, 3]');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses function call', () => {
      const r = parseOk('x = foo(1, 2)');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses CreateObject call', () => {
      const r = parseOk('x = CreateObject("roUrlTransfer")');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses chained method call', () => {
      const r = parseOk('a.b.c(d, e)');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.ExpressionStatement);
    });

    it('parses optional chaining', () => {
      const r = parseOk('x = a?.b?[0]?()');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses array literal', () => {
      const r = parseOk('a = [1, 2, 3]');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses multi-line array literal', () => {
      const r = parseOk('a = [\n  1\n  2\n  3\n]');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses AA literal', () => {
      const r = parseOk('a = { key: "value", num: 42 }');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses AA with quoted keys', () => {
      const r = parseOk('a = { "Jane Doe": 1001, "John Doe": 1002 }');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses multi-line AA literal', () => {
      const r = parseOk('aa = {\n  key1: "value"\n  key2: 42\n}');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses AA with function value', () => {
      const r = parseOk('obj = {\n  add: function(a, b)\n    return a + b\n  end function\n}');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.AssignmentStatement);
    });

    it('parses boolean literals', () => {
      parseOk('x = true');
      parseOk('x = false');
    });

    it('parses invalid literal', () => {
      parseOk('x = invalid');
    });

    it('parses LINE_NUM', () => {
      parseOk('x = LINE_NUM');
    });

    it('parses bitshift operators', () => {
      parseOk('x = a << 2');
      parseOk('x = a >> 1');
    });

    it('parses mod operator', () => {
      parseOk('x = a mod b');
    });

    it('parses integer division', () => {
      parseOk('x = a \\ b');
    });

    it('parses <> (not equal)', () => {
      parseOk('x = a <> b');
    });
  });

  // ─── Conditional compilation ────────────────────────────────────────────

  describe('conditional compilation', () => {
    it('parses #if/#end if', () => {
      const r = parseOk('#if DEBUG\n  print "debug"\n#end if');
      const cc = firstStatement(r);
      expect(cc.kind).to.equal(SyntaxKind.ConditionalCompilation);
    });

    it('parses #if/#else/#end if', () => {
      const r = parseOk('#if DEBUG\n  print "debug"\n#else\n  print "release"\n#end if');
      const cc = firstStatement(r);
      expect(cc.kind).to.equal(SyntaxKind.ConditionalCompilation);
    });

    it('parses #if/#else if/#end if', () => {
      const r = parseOk('#if A\n  print 1\n#else if B\n  print 2\n#end if');
      const cc = firstStatement(r);
      expect(cc.kind).to.equal(SyntaxKind.ConditionalCompilation);
    });

    it('parses #const', () => {
      const r = parseOk('#const FLAG = true');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.HashConstStatement);
    });

    it('parses #error', () => {
      const r = parseOk('#error TODO: implement this');
      expect(firstStatement(r).kind).to.equal(SyntaxKind.HashErrorStatement);
    });
  });

  // ─── Error recovery ─────────────────────────────────────────────────────

  describe('error recovery', () => {
    it('produces a tree for missing end function', () => {
      const r = parse('function foo()\n  return 1');
      expect(r.root).to.exist;
      expect(r.diagnostics.length).to.be.greaterThan(0);
      // Still round-trips
      expect(r.root.getText()).to.equal('function foo()\n  return 1');
    });

    it('produces a tree for missing end if', () => {
      const r = parse('if x > 0\n  print "yes"');
      expect(r.root).to.exist;
      expect(r.diagnostics.length).to.be.greaterThan(0);
    });

    it('produces a tree for missing end for', () => {
      const r = parse('for i = 1 to 10\n  print i');
      expect(r.root).to.exist;
      expect(r.diagnostics.length).to.be.greaterThan(0);
    });

    it('produces a tree for missing end while', () => {
      const r = parse('while true\n  print "loop"');
      expect(r.root).to.exist;
      expect(r.diagnostics.length).to.be.greaterThan(0);
    });

    it('produces a tree for missing catch', () => {
      const r = parse('try\n  print 1');
      expect(r.root).to.exist;
      expect(r.diagnostics.length).to.be.greaterThan(0);
    });

    it('produces a tree for unexpected tokens', () => {
      const r = parse('~~~');
      expect(r.root).to.exist;
      expect(r.diagnostics.length).to.be.greaterThan(0);
    });

    it('always round-trips even with errors', () => {
      const sources = [
        'function foo()\n  return 1',
        'if x > 0\n  print "yes"',
        'for i = 1 to 10\n  print i',
      ];
      for (const src of sources) {
        const r = parse(src);
        expect(r.root.getText()).to.equal(src);
      }
    });
  });

  // ─── Complex programs (from Roku docs) ──────────────────────────────────

  describe('complex programs from Roku docs', () => {
    it('parses factorial function', () => {
      const src = [
        'function factorial(n)',
        '  if n < 0 then',
        '    throw "Cannot calculate negative factorial."',
        '  else if n = 0 then',
        '    return 1',
        '  else',
        '    return n * factorial(n - 1)',
        '  end if',
        'end function',
      ].join('\n');
      const r = parseOk(src);
      expect(r.root.getText()).to.equal(src);
    });

    it('parses AA with method', () => {
      const src = [
        'sub main()',
        '  obj = {',
        '    add: function()',
        '      m.result = m.a + m.b',
        '    end function,',
        '    a: 5,',
        '    b: 10',
        '  }',
        '  obj.add()',
        '  print obj.result',
        'end sub',
      ].join('\n');
      const r = parseOk(src);
      expect(r.root.getText()).to.equal(src);
    });

    it('parses dim + nested for', () => {
      const src = [
        'dim c[5, 4, 6]',
        'for x = 1 to 5',
        '  for y = 1 to 4',
        '    for z = 1 to 6',
        '      c[x, y, z] = x + y + z',
        '    end for',
        '  end for',
        'end for',
      ].join('\n');
      const r = parseOk(src);
      expect(r.root.getText()).to.equal(src);
    });

    it('parses try/catch with nested try', () => {
      const src = [
        'try',
        '  print 1/0',
        'catch e',
        '  try',
        '    print e.message',
        '  catch e2',
        '    print "nested error"',
        '  end try',
        'end try',
      ].join('\n');
      const r = parseOk(src);
      expect(r.root.getText()).to.equal(src);
    });

    it('parses for each with AA', () => {
      const src = [
        'aa = { joe: 10, fred: 11, sue: 9 }',
        'for each n in aa',
        '  print n',
        'end for',
      ].join('\n');
      const r = parseOk(src);
      expect(r.root.getText()).to.equal(src);
    });

    it('parses complex if/else if chain', () => {
      const src = [
        'if type(msg) = "roVideoPlayerEvent" then',
        '  print "video event"',
        'else if type(msg) = "roUniversalControlEvent" then',
        '  print "button press"',
        'elseif msg = invalid then',
        '  print "timeout"',
        'end if',
      ].join('\n');
      const r = parseOk(src);
      expect(r.root.getText()).to.equal(src);
    });

    it('parses while with exit and continue', () => {
      const src = [
        'counter = 0',
        'while counter < 3',
        '  if counter = 1 then',
        '    counter++',
        '    continue while',
        '  end if',
        '  print counter',
        '  counter++',
        'end while',
      ].join('\n');
      const r = parseOk(src);
      expect(r.root.getText()).to.equal(src);
    });
  });
});

  describe('@ XML attribute access operator', () => {
    it('parses node@attr', () => {
      const r = parseOk('data = node@width');
      expect(r.root.getText()).to.equal('data = node@width');
    });

    it('parses Val(node@width)', () => {
      const r = parseOk('data.imageWidth = Val(node@width)');
      expect(r.root.getText()).to.equal('data.imageWidth = Val(node@width)');
    });

    it('parses multiple @ attribute accesses', () => {
      const r = parseOk('w = node@width\nh = node@height');
      expect(r.root.getText()).to.equal('w = node@width\nh = node@height');
    });

    it('@ chained with dot access', () => {
      const r = parseOk('x = item.node@id');
      expect(r.root.getText()).to.equal('x = item.node@id');
    });
  });

  describe('conditional compilation', () => {
    it('parses #if with manifest constants', () => {
      const r = parseOk('#if DEBUG\n  print "debug"\n#end if');
      expect(r.root.getText()).to.equal('#if DEBUG\n  print "debug"\n#end if');
    });

    it('parses #const with local boolean', () => {
      const r = parseOk('#const FEATURE_A = true');
      expect(r.root.getText()).to.equal('#const FEATURE_A = true');
    });

    it('parses #if/#else if/#else/#end if', () => {
      const r = parseOk('#if FEATURE_A\n  print 1\n#else if FEATURE_B\n  print 2\n#else\n  print 3\n#end if');
      expect(r.root.getText()).to.equal('#if FEATURE_A\n  print 1\n#else if FEATURE_B\n  print 2\n#else\n  print 3\n#end if');
    });
  });
