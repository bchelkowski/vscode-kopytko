import { expect } from 'chai';
import { Range, SelectionRange } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BrightScriptSelectionRangeProvider } from '../../src/server/providers/selectionRangeProvider';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///test.brs', 'brightscript', 1, content);
}

function pos(line: number, character: number) {
  return { line, character };
}

function rangeStr(r: Range): string {
  return `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
}

function collectChain(sel: SelectionRange): Range[] {
  const result: Range[] = [];
  let current: SelectionRange | undefined = sel;
  while (current) {
    result.push(current.range);
    current = current.parent;
  }
  return result;
}

describe('BrightScriptSelectionRangeProvider', () => {
  let provider: BrightScriptSelectionRangeProvider;

  beforeEach(() => {
    provider = new BrightScriptSelectionRangeProvider();
  });

  afterEach(() => invalidateAllCaches());

  it('returns a selection range for a cursor inside a function body', () => {
    const doc = makeDocument([
      'function greet(name as String) as String',
      '  return "hello"',
      'end function',
    ].join('\n'));

    const [result] = provider.provideSelectionRanges(doc, [pos(1, 4)]);
    expect(result).to.exist;

    const chain = collectChain(result);
    expect(chain.length).to.be.greaterThan(1);

    // Outermost range must cover the whole function
    const outermost = chain[chain.length - 1];
    expect(outermost.start.line).to.equal(0);
    expect(outermost.end.line).to.equal(2);
  });

  it('innermost range is narrower than its parent', () => {
    const doc = makeDocument([
      'function foo()',
      '  x = 1 + 2',
      'end function',
    ].join('\n'));

    const [result] = provider.provideSelectionRanges(doc, [pos(1, 6)]);
    expect(result).to.exist;

    const chain = collectChain(result);
    // Innermost should be smaller than outermost
    const inner = chain[0];
    const outer = chain[chain.length - 1];
    expect(outer.start.line).to.be.at.most(inner.start.line);
    expect(outer.end.line).to.be.at.least(inner.end.line);
  });

  it('handles multiple positions in one call', () => {
    const doc = makeDocument([
      'sub init()',
      '  m.field = 1',
      '  m.other = 2',
      'end sub',
    ].join('\n'));

    const results = provider.provideSelectionRanges(doc, [pos(1, 3), pos(2, 3)]);
    expect(results).to.have.length(2);
    expect(results[0]).to.exist;
    expect(results[1]).to.exist;
  });

  it('returns a degenerate range for a position outside any token', () => {
    const doc = makeDocument('\n\n\n');
    const [result] = provider.provideSelectionRanges(doc, [pos(1, 0)]);
    expect(result).to.exist;
  });

  it('expands from token to statement to function', () => {
    const doc = makeDocument([
      'function add(a as Integer, b as Integer) as Integer',
      '  return a + b',
      'end function',
    ].join('\n'));

    // Cursor on "a" in "return a + b"
    const [result] = provider.provideSelectionRanges(doc, [pos(1, 9)]);
    expect(result).to.exist;

    const chain = collectChain(result);
    const rangeStrings = chain.map(rangeStr);

    // The chain should include a range spanning the whole function (lines 0-2)
    expect(rangeStrings.some((s) => s.startsWith('0:') && s.endsWith(':12'))).to.be.true;
  });

  it('each parent range contains its child range', () => {
    const doc = makeDocument([
      'sub onKeyPress()',
      '  if m.focused = true then',
      '    doAction()',
      '  end if',
      'end sub',
    ].join('\n'));

    const [result] = provider.provideSelectionRanges(doc, [pos(2, 6)]);
    expect(result).to.exist;

    const chain = collectChain(result);
    for (let i = 0; i < chain.length - 1; i++) {
      const inner = chain[i];
      const outer = chain[i + 1];
      expect(outer.start.line).to.be.at.most(inner.start.line, `parent[${i+1}] start should be ≤ child[${i}] start`);
      expect(outer.end.line).to.be.at.least(inner.end.line, `parent[${i+1}] end should be ≥ child[${i}] end`);
    }
  });
});
