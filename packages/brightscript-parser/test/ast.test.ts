import { expect } from 'chai';
import {
  parse, SyntaxKind, wrapNode,
  SourceFile, FunctionDeclaration, FunctionExpression,
  IfStatement, ForStatement, ForEachStatement, WhileStatement,
  TryStatement, CatchClause,
  ReturnStatement, PrintStatement, ThrowStatement, DimStatement,
  AssignmentStatement, ExpressionStatement,
  BinaryExpression, UnaryExpression, CallExpression, DotExpression,
  IdentifierExpression, LiteralExpression, ArrayLiteral, AALiteral,
  walk, findAll, buildScopes, resolve,
} from '../src/index.js';
import type { AstVisitor } from '../src/index.js';

/** Parse and return the SourceFile AST wrapper. */
function parseFile(src: string): SourceFile {
  const r = parse(src);
  return new SourceFile(r.root);
}

describe('Typed AST wrappers', () => {
  describe('FunctionDeclaration', () => {
    it('extracts name and params', () => {
      const file = parseFile('function add(a as Integer, b as Integer) as Integer\n  return a + b\nend function');
      const fn = file.statements[0] as FunctionDeclaration;
      expect(fn).to.be.instanceOf(FunctionDeclaration);
      expect(fn.name).to.equal('add');
      expect(fn.isFunction).to.be.true;
      expect(fn.isSub).to.be.false;
      expect(fn.params).to.have.length(2);
      expect(fn.params[0].name).to.equal('a');
      expect(fn.params[0].typeName).to.equal('Integer');
      expect(fn.params[1].name).to.equal('b');
      expect(fn.returnType).to.equal('Integer');
    });

    it('extracts sub with no return type', () => {
      const file = parseFile('sub main()\n  print "hello"\nend sub');
      const fn = file.statements[0] as FunctionDeclaration;
      expect(fn.isSub).to.be.true;
      expect(fn.name).to.equal('main');
      expect(fn.returnType).to.be.undefined;
    });

    it('extracts default param values', () => {
      const file = parseFile('function add(a as Integer, b=5 as Integer) as Integer\n  return a + b\nend function');
      const fn = file.statements[0] as FunctionDeclaration;
      expect(fn.params[1].hasDefault).to.be.true;
    });
  });

  describe('IfStatement', () => {
    it('extracts else if and else clauses', () => {
      const file = parseFile('if a\n  print 1\nelse if b\n  print 2\nelse\n  print 3\nend if');
      const ifStmt = file.statements[0] as IfStatement;
      expect(ifStmt).to.be.instanceOf(IfStatement);
      expect(ifStmt.elseIfClauses).to.have.length(1);
      expect(ifStmt.elseClause).to.exist;
    });
  });

  describe('ForStatement', () => {
    it('extracts loop variable', () => {
      const file = parseFile('for i = 1 to 10\n  print i\nend for');
      const forStmt = file.statements[0] as ForStatement;
      expect(forStmt).to.be.instanceOf(ForStatement);
      expect(forStmt.variable).to.equal('i');
    });
  });

  describe('ForEachStatement', () => {
    it('extracts iterator variable', () => {
      const file = parseFile('for each item in list\n  print item\nend for');
      const forEach = file.statements[0] as ForEachStatement;
      expect(forEach).to.be.instanceOf(ForEachStatement);
      expect(forEach.variable).to.equal('item');
    });
  });

  describe('TryStatement', () => {
    it('extracts catch clause variable', () => {
      const file = parseFile('try\n  print 1/0\ncatch e\n  print e.message\nend try');
      const tryStmt = file.statements[0] as TryStatement;
      expect(tryStmt).to.be.instanceOf(TryStatement);
      expect(tryStmt.catchClause).to.exist;
      expect(tryStmt.catchClause!.variable).to.equal('e');
    });
  });

  describe('AssignmentStatement', () => {
    it('extracts target and value', () => {
      const file = parseFile('x = 42');
      const assign = file.statements[0] as AssignmentStatement;
      expect(assign).to.be.instanceOf(AssignmentStatement);
      expect(assign.isCompound).to.be.false;
    });

    it('detects compound assignment', () => {
      const file = parseFile('x += 1');
      const assign = file.statements[0] as AssignmentStatement;
      expect(assign.isCompound).to.be.true;
    });
  });

  describe('CallExpression', () => {
    it('extracts callee and args', () => {
      const file = parseFile('foo(1, 2, 3)');
      const expr = file.statements[0] as ExpressionStatement;
      const call = expr.expression as CallExpression;
      expect(call).to.be.instanceOf(CallExpression);
      expect(call.args).to.have.length(3);
    });
  });

  describe('DotExpression', () => {
    it('extracts object and member', () => {
      const file = parseFile('x = a.b');
      const assign = file.statements[0] as AssignmentStatement;
      const dot = assign.value as DotExpression;
      expect(dot).to.be.instanceOf(DotExpression);
      expect(dot.member).to.equal('b');
    });
  });

  describe('ArrayLiteral', () => {
    it('extracts elements', () => {
      const file = parseFile('a = [1, 2, 3]');
      const assign = file.statements[0] as AssignmentStatement;
      const arr = assign.value as ArrayLiteral;
      expect(arr).to.be.instanceOf(ArrayLiteral);
      expect(arr.elements).to.have.length(3);
    });
  });

  describe('AALiteral', () => {
    it('extracts fields', () => {
      const file = parseFile('a = { name: "John", age: 30 }');
      const assign = file.statements[0] as AssignmentStatement;
      const aa = assign.value as AALiteral;
      expect(aa).to.be.instanceOf(AALiteral);
      expect(aa.fields).to.have.length(2);
      expect(aa.fields[0].key).to.equal('name');
      expect(aa.fields[1].key).to.equal('age');
    });
  });

  describe('DimStatement', () => {
    it('extracts variable name', () => {
      const file = parseFile('dim arr[5]');
      const dim = file.statements[0] as DimStatement;
      expect(dim).to.be.instanceOf(DimStatement);
      expect(dim.variable).to.equal('arr');
    });
  });
});

describe('Visitor', () => {
  it('visits all function declarations', () => {
    const src = 'function foo()\n  return 1\nend function\nsub bar()\n  print 2\nend sub';
    const r = parse(src);
    const names: string[] = [];
    walk(r.root, {
      visitFunctionDeclaration(node) {
        names.push(node.name);
      },
    });
    expect(names).to.deep.equal(['foo', 'bar']);
  });

  it('visits all call expressions', () => {
    const src = 'x = foo(1)\ny = bar(2, 3)';
    const r = parse(src);
    const calls: string[] = [];
    walk(r.root, {
      visitCallExpression(node) {
        const callee = node.callee;
        if (callee instanceof IdentifierExpression) {
          calls.push(callee.name);
        }
      },
    });
    expect(calls).to.deep.equal(['foo', 'bar']);
  });

  it('visits nested functions', () => {
    const src = 'function outer()\n  inner = function()\n    return 1\n  end function\nend function';
    const r = parse(src);
    const kinds: string[] = [];
    walk(r.root, {
      visitFunctionDeclaration(node) { kinds.push('decl:' + node.name); },
      visitFunctionExpression() { kinds.push('expr:anon'); },
    });
    expect(kinds).to.deep.equal(['decl:outer', 'expr:anon']);
  });

  it('skips children when returning false', () => {
    const src = 'function outer()\n  x = 1\nend function';
    const r = parse(src);
    const visited: string[] = [];
    walk(r.root, {
      visitFunctionDeclaration(node) {
        visited.push('func');
        return false; // skip body
      },
      visitAssignmentStatement() {
        visited.push('assign'); // should NOT be reached
      },
    });
    expect(visited).to.deep.equal(['func']);
  });

  it('visits all assignment statements', () => {
    const src = 'a = 1\nb = 2\nc += 3';
    const r = parse(src);
    const targets: boolean[] = [];
    walk(r.root, {
      visitAssignmentStatement(node) {
        targets.push(node.isCompound);
      },
    });
    expect(targets).to.deep.equal([false, false, true]);
  });

  it('findAll collects specific node types', () => {
    const src = 'function foo()\n  return 1\nend function\nfunction bar()\n  return 2\nend function';
    const r = parse(src);
    const fns = findAll(r.root, SyntaxKind.FunctionDeclaration, n => new FunctionDeclaration(n));
    expect(fns.map(f => f.name)).to.deep.equal(['foo', 'bar']);
  });
});

describe('Scope analysis', () => {
  it('collects function declarations at file scope', () => {
    const r = parse('function foo()\n  return 1\nend function\nfunction bar()\n  return 2\nend function');
    const scope = buildScopes(r.root);
    expect(scope.declarations.has('foo')).to.be.true;
    expect(scope.declarations.has('bar')).to.be.true;
    expect(scope.declarations.get('foo')!.kind).to.equal('function');
  });

  it('collects parameters in function scope', () => {
    const r = parse('function add(a, b)\n  return a + b\nend function');
    const scope = buildScopes(r.root);
    expect(scope.children).to.have.length(1);
    const fnScope = scope.children[0];
    expect(fnScope.declarations.has('a')).to.be.true;
    expect(fnScope.declarations.has('b')).to.be.true;
    expect(fnScope.declarations.get('a')!.kind).to.equal('parameter');
  });

  it('collects variable assignments in function scope', () => {
    const r = parse('function foo()\n  x = 1\n  y = 2\nend function');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(fnScope.declarations.has('x')).to.be.true;
    expect(fnScope.declarations.has('y')).to.be.true;
    expect(fnScope.declarations.get('x')!.kind).to.equal('variable');
  });

  it('collects for loop variable', () => {
    const r = parse('function foo()\n  for i = 1 to 10\n    print i\n  end for\nend function');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(fnScope.declarations.has('i')).to.be.true;
    expect(fnScope.declarations.get('i')!.kind).to.equal('for-variable');
  });

  it('collects for each variable', () => {
    const r = parse('function foo()\n  for each item in list\n    print item\n  end for\nend function');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(fnScope.declarations.has('item')).to.be.true;
    expect(fnScope.declarations.get('item')!.kind).to.equal('for-variable');
  });

  it('collects catch variable', () => {
    const r = parse('function foo()\n  try\n    print 1\n  catch e\n    print e\n  end try\nend function');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(fnScope.declarations.has('e')).to.be.true;
    expect(fnScope.declarations.get('e')!.kind).to.equal('catch-variable');
  });

  it('collects dim variable', () => {
    const r = parse('function foo()\n  dim arr[5]\nend function');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(fnScope.declarations.has('arr')).to.be.true;
    expect(fnScope.declarations.get('arr')!.kind).to.equal('dim-variable');
  });

  it('creates child scopes for nested functions', () => {
    const r = parse('function outer()\n  inner = function(x)\n    return x\n  end function\nend function');
    const scope = buildScopes(r.root);
    const outerScope = scope.children[0];
    expect(outerScope.ownerName).to.equal('outer');
    expect(outerScope.children).to.have.length(1);
    const innerScope = outerScope.children[0];
    expect(innerScope.declarations.has('x')).to.be.true;
  });

  it('resolve walks up the scope chain', () => {
    const r = parse('function outer(a)\n  function inner(b)\n    x = a + b\n  end function\nend function');
    const scope = buildScopes(r.root);
    const outerScope = scope.children[0];
    const innerScope = outerScope.children[0];

    expect(resolve('b', innerScope)).to.exist;
    expect(resolve('b', innerScope)!.kind).to.equal('parameter');
    expect(resolve('a', innerScope)).to.exist; // found in parent scope
    expect(resolve('a', innerScope)!.kind).to.equal('parameter');
    expect(resolve('unknown', innerScope)).to.be.undefined;
  });

  it('case-insensitive lookup', () => {
    const r = parse('function foo(MyParam)\n  return MyParam\nend function');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(resolve('myparam', fnScope)).to.exist;
    expect(resolve('MYPARAM', fnScope)).to.exist;
    expect(resolve('MyParam', fnScope)).to.exist;
  });

  it('collects references in function scope', () => {
    const r = parse('function foo(a)\n  x = a + 1\n  return x\nend function');
    const scope = buildScopes(r.root);
    const fnScope = scope.children[0];
    expect(fnScope.references.length).to.be.greaterThan(0);
    const refNames = fnScope.references.map(r => r.nameLower);
    expect(refNames).to.include('a');
    expect(refNames).to.include('x');
  });
});
