import { expect } from 'chai';
import { FoldingRangeKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BrightScriptFoldingRangeProvider } from '../../src/server/providers/foldingRangeProvider';
import { invalidateAllCaches } from '../../src/server/utils/documentCache';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///test.brs', 'brightscript', 1, content);
}

describe('BrightScriptFoldingRangeProvider', () => {
  let provider: BrightScriptFoldingRangeProvider;

  beforeEach(() => {
    provider = new BrightScriptFoldingRangeProvider();
  });

  afterEach(() => invalidateAllCaches());

  it('returns empty array for a file with no foldable constructs', () => {
    const doc = makeDocument('x = 1\nprint x\n');
    expect(provider.provideFoldingRanges(doc)).to.be.empty;
  });

  it('folds a function declaration', () => {
    const doc = makeDocument([
      'function greet(name as String) as String',
      '  return "hello " + name',
      'end function',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    expect(ranges).to.have.length(1);
    expect(ranges[0].startLine).to.equal(0);
    expect(ranges[0].endLine).to.equal(2);
  });

  it('folds a sub declaration', () => {
    const doc = makeDocument([
      'sub init()',
      '  m.label = "hello"',
      'end sub',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    expect(ranges).to.have.length(1);
    expect(ranges[0].startLine).to.equal(0);
    expect(ranges[0].endLine).to.equal(2);
  });

  it('does not fold a single-line block', () => {
    const doc = makeDocument('function noop() : end function');
    const ranges = provider.provideFoldingRanges(doc);
    expect(ranges).to.be.empty;
  });

  it('folds nested functions', () => {
    const doc = makeDocument([
      'function outer()',
      '  callback = function()',
      '    return 1',
      '  end function',
      'end function',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    expect(ranges).to.have.length(2);
    const lines = ranges.map((r) => ({ start: r.startLine, end: r.endLine }));
    expect(lines).to.deep.include({ start: 0, end: 4 });
    expect(lines).to.deep.include({ start: 1, end: 3 });
  });

  it('folds an if statement', () => {
    const doc = makeDocument([
      'if x > 0 then',
      '  print "positive"',
      'end if',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    const ifRange = ranges.find((r) => r.startLine === 0);
    expect(ifRange).to.exist;
    expect(ifRange!.endLine).to.equal(2);
  });

  it('folds if/else if/else clauses independently', () => {
    const doc = makeDocument([
      'if x > 0 then',
      '  print "pos"',
      'else if x < 0 then',
      '  print "neg"',
      'else',
      '  print "zero"',
      'end if',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    const startLines = ranges.map((r) => r.startLine);
    // IfStatement covers line 0..6; ElseIfClause starts at 2; ElseClause starts at 4
    expect(startLines).to.include(0);
    expect(startLines).to.include(2);
    expect(startLines).to.include(4);
  });

  it('folds a for loop', () => {
    const doc = makeDocument([
      'for i = 0 to 9',
      '  print i',
      'end for',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    expect(ranges).to.have.length(1);
    expect(ranges[0].startLine).to.equal(0);
    expect(ranges[0].endLine).to.equal(2);
  });

  it('folds a for each loop', () => {
    const doc = makeDocument([
      'for each item in list',
      '  print item',
      'end for',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    expect(ranges).to.have.length(1);
    expect(ranges[0].startLine).to.equal(0);
    expect(ranges[0].endLine).to.equal(2);
  });

  it('folds a while loop', () => {
    const doc = makeDocument([
      'while x > 0',
      '  x = x - 1',
      'end while',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    expect(ranges).to.have.length(1);
    expect(ranges[0].startLine).to.equal(0);
    expect(ranges[0].endLine).to.equal(2);
  });

  it('folds try/catch blocks', () => {
    const doc = makeDocument([
      'try',
      '  doSomething()',
      'catch e',
      '  print e.message',
      'end try',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    const startLines = ranges.map((r) => r.startLine);
    expect(startLines).to.include(0); // TryStatement
    expect(startLines).to.include(2); // CatchClause
  });

  it('folds a contiguous @import block with kind Imports', () => {
    const doc = makeDocument([
      "' @import /State.brs from @dazn/kopytko-framework",
      "' @import /Router.brs from @dazn/kopytko-framework",
      "' @import /utils/helpers.brs",
      '',
      'sub init()',
      'end sub',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    const importRange = ranges.find((r) => r.kind === FoldingRangeKind.Imports);
    expect(importRange).to.exist;
    expect(importRange!.startLine).to.equal(0);
    expect(importRange!.endLine).to.equal(2);
  });

  it('does not fold a single @import line', () => {
    const doc = makeDocument([
      "' @import /State.brs from @dazn/kopytko-framework",
      '',
      'sub init()',
      'end sub',
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    const importRanges = ranges.filter((r) => r.kind === FoldingRangeKind.Imports);
    expect(importRanges).to.be.empty;
  });

  it('folds multiple separate @import blocks independently', () => {
    const doc = makeDocument([
      "' @import /A.brs",
      "' @import /B.brs",
      '',
      'sub init()',
      'end sub',
      '',
      "' @mock /C.brs",
      "' @mock /D.brs",
    ].join('\n'));
    const ranges = provider.provideFoldingRanges(doc);
    const importRanges = ranges.filter((r) => r.kind === FoldingRangeKind.Imports);
    expect(importRanges).to.have.length(2);
    expect(importRanges[0].startLine).to.equal(0);
    expect(importRanges[0].endLine).to.equal(1);
    expect(importRanges[1].startLine).to.equal(6);
    expect(importRanges[1].endLine).to.equal(7);
  });
});
