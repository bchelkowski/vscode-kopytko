import { expect } from 'chai';
import * as sinon from 'sinon';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  BrightScriptSemanticTokensProvider,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
} from '../../src/server/providers/semanticTokensProvider';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///test.brs', 'brightscript', 1, content);
}

interface DecodedToken {
  line: number;
  char: number;
  length: number;
  type: string;
  modifiers: string[];
}

/**
 * Decodes the flat, delta-encoded `data` array (quintuples of
 * [Δline, Δchar, length, typeIdx, modBits]) back into absolute tokens for
 * readable assertions.
 */
function decode(data: number[]): DecodedToken[] {
  const tokens: DecodedToken[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaChar = data[i + 1];
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;
    const modBits = data[i + 4];
    const modifiers = SEMANTIC_TOKEN_MODIFIERS.filter((_, idx) => (modBits & (1 << idx)) !== 0);
    tokens.push({
      line,
      char,
      length: data[i + 2],
      type: SEMANTIC_TOKEN_TYPES[data[i + 3]],
      modifiers: [...modifiers],
    });
  }
  return tokens;
}

function tokensFor(content: string): DecodedToken[] {
  const provider = new BrightScriptSemanticTokensProvider();
  const result = provider.provideSemanticTokens(makeDocument(content));
  return decode(result.data);
}

/** Finds the token whose name matches the substring at the given line. */
function tokenAt(tokens: DecodedToken[], line: number, char: number): DecodedToken | undefined {
  return tokens.find((t) => t.line === line && t.char === char);
}

describe('BrightScriptSemanticTokensProvider', () => {
  afterEach(() => { sinon.restore(); invalidateAllCaches(); });

  describe('legend', () => {
    it('exposes the four token types and the declaration modifier', () => {
      const legend = new BrightScriptSemanticTokensProvider().getLegend();
      expect(legend.tokenTypes).to.deep.equal(['function', 'parameter', 'variable', 'property']);
      expect(legend.tokenModifiers).to.deep.equal(['declaration']);
    });
  });

  describe('parameters', () => {
    it('classifies a parameter at its declaration and at a use site', () => {
      const src = [
        'function greet(name as String) as String',
        '  return name',
        'end function',
      ].join('\n');
      const tokens = tokensFor(src);

      // Declaration: `name` at column 15 of line 0
      const decl = tokenAt(tokens, 0, 'function greet('.length);
      expect(decl, 'param declaration').to.exist;
      expect(decl!.type).to.equal('parameter');
      expect(decl!.modifiers).to.include('declaration');

      // Use: `name` on line 1 after `  return `
      const use = tokenAt(tokens, 1, '  return '.length);
      expect(use, 'param use').to.exist;
      expect(use!.type).to.equal('parameter');
      expect(use!.modifiers).to.not.include('declaration');
    });
  });

  describe('locals', () => {
    it('classifies an `=` assignment target as a variable', () => {
      const tokens = tokensFor([
        'sub main()',
        '  count = 5',
        '  print count',
        'end sub',
      ].join('\n'));

      const decl = tokenAt(tokens, 1, '  '.length);
      expect(decl, 'variable declaration').to.exist;
      expect(decl!.type).to.equal('variable');
      expect(decl!.modifiers).to.include('declaration');

      const use = tokenAt(tokens, 2, '  print '.length);
      expect(use, 'variable use').to.exist;
      expect(use!.type).to.equal('variable');
    });

    it('classifies for / for each / dim locals as variables', () => {
      const tokens = tokensFor([
        'sub main()',
        '  dim items[3]',
        '  for i = 0 to 2',
        '    print i',
        '  end for',
        '  for each entry in items',
        '    print entry',
        '  end for',
        'end sub',
      ].join('\n'));

      // `i` used inside the for body
      const iUse = tokenAt(tokens, 3, '    print '.length);
      expect(iUse, 'for-variable use').to.exist;
      expect(iUse!.type).to.equal('variable');

      // `entry` used inside the for-each body
      const entryUse = tokenAt(tokens, 6, '    print '.length);
      expect(entryUse, 'for-each variable use').to.exist;
      expect(entryUse!.type).to.equal('variable');

      // `items` used as the for-each collection resolves to the dim variable
      const itemsUse = tokenAt(tokens, 5, '  for each entry in '.length);
      expect(itemsUse, 'dim variable use').to.exist;
      expect(itemsUse!.type).to.equal('variable');
    });

    it('classifies a catch variable as a variable', () => {
      const tokens = tokensFor([
        'sub main()',
        '  try',
        '    print 1',
        '  catch e',
        '    print e',
        '  end try',
        'end sub',
      ].join('\n'));

      const use = tokenAt(tokens, 4, '    print '.length);
      expect(use, 'catch variable use').to.exist;
      expect(use!.type).to.equal('variable');
    });
  });

  describe('functions and calls', () => {
    it('classifies a user function declaration and its call site as function', () => {
      const tokens = tokensFor([
        'sub main()',
        '  helper()',
        'end sub',
        '',
        'function helper() as Integer',
        '  return 1',
        'end function',
      ].join('\n'));

      const call = tokenAt(tokens, 1, '  '.length);
      expect(call, 'call site').to.exist;
      expect(call!.type).to.equal('function');
      expect(call!.modifiers).to.not.include('declaration');

      const decl = tokenAt(tokens, 4, 'function '.length);
      expect(decl, 'function declaration').to.exist;
      expect(decl!.type).to.equal('function');
      expect(decl!.modifiers).to.include('declaration');
    });

    it('emits a call callee exactly once (no overlapping tokens)', () => {
      const tokens = tokensFor([
        'sub main()',
        '  foo(x)',
        'end sub',
      ].join('\n'));

      const calleeTokens = tokens.filter((t) => t.line === 1 && t.char === '  '.length);
      expect(calleeTokens).to.have.lengthOf(1);
      expect(calleeTokens[0].type).to.equal('function');
    });

    it('classifies a builtin/global call callee as function', () => {
      const tokens = tokensFor([
        'sub main()',
        '  node = CreateObject("roSGNode", "Node")',
        'end sub',
      ].join('\n'));

      const callee = tokenAt(tokens, 1, '  node = '.length);
      expect(callee, 'CreateObject callee').to.exist;
      expect(callee!.type).to.equal('function');
    });
  });

  describe('m-fields', () => {
    it('classifies m.field reads and assignment targets as property; never tags m itself', () => {
      const tokens = tokensFor([
        'sub init()',
        '  m.counter = 0',
        '  print m.counter',
        'end sub',
      ].join('\n'));

      // Assignment target `counter`
      const assign = tokenAt(tokens, 1, '  m.'.length);
      expect(assign, 'm-field assignment').to.exist;
      expect(assign!.type).to.equal('property');

      // Read `counter`
      const read = tokenAt(tokens, 2, '  print m.'.length);
      expect(read, 'm-field read').to.exist;
      expect(read!.type).to.equal('property');

      // `m` itself must not be emitted
      const mAtAssign = tokenAt(tokens, 1, '  '.length);
      expect(mAtAssign, 'm should not be tokenized').to.be.undefined;
    });
  });

  describe('edge cases', () => {
    it('returns no tokens for an empty document', () => {
      expect(tokensFor('')).to.deep.equal([]);
    });

    it('does not throw on a document with parse errors', () => {
      const provider = new BrightScriptSemanticTokensProvider();
      expect(() => provider.provideSemanticTokens(makeDocument('function broken( as'))).to.not.throw();
    });
  });
});
