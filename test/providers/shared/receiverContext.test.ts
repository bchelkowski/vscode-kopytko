import { expect } from 'chai';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getReceiverNameAtPosition, isDotAccessAtPosition, findAssignedConstructor } from '../../../src/server/providers/shared/receiverContext';
import { invalidateAllCaches } from '../../../src/server/utils/documentCache';

function makeDocument(content: string): TextDocument {
  return TextDocument.create('file:///workspace/app/Test.brs', 'brightscript', 1, content);
}

describe('receiverContext', () => {
  afterEach(() => invalidateAllCaches());

  describe('getReceiverNameAtPosition', () => {
    it('extracts the receiver before a dot', () => {
      const doc = makeDocument('myArr.');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 6 })).to.equal('myArr');
    });

    it('extracts the receiver from a longer line', () => {
      const doc = makeDocument('  myUrl.GetToString()');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 9 })).to.equal('myUrl');
    });

    it('handles m. receiver returning the field name (last segment of a dotted chain)', () => {
      // cursor right after the second dot: `m.transfer.`
      const doc = makeDocument('m.transfer.');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 11 })).to.equal('transfer');
    });

    it('returns null when cursor is not after a dot', () => {
      const doc = makeDocument('myArr');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 5 })).to.be.null;
    });

    it('returns null for an empty line', () => {
      const doc = makeDocument('');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 0 })).to.be.null;
    });

    it('returns null when only a dot is present with no identifier before it', () => {
      const doc = makeDocument('.');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 1 })).to.be.null;
    });

    it('distinguishes @attr access from .member access', () => {
      const doc = makeDocument('node@width');
      // cursor right after "@width" — this is XML attribute access, not a dot-member.
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 10 })).to.be.null;
    });

    it('supports optional chaining (?.)', () => {
      const doc = makeDocument('myArr?.');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 7 })).to.equal('myArr');
    });

    it('does not treat ?[ or ?( as a dot-member context', () => {
      const doc = makeDocument('myArr?[0]');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 7 })).to.be.null;
    });

    it('returns null for a complex receiver (call/index expression) it cannot name', () => {
      const doc = makeDocument('foo().');
      expect(getReceiverNameAtPosition(doc, { line: 0, character: 6 })).to.be.null;
    });

    it('does not leak a completed dot-expression\'s context to a cursor on a later, unrelated line', () => {
      // Regression: a naive "nearest preceding token" walk with no line
      // boundary would treat the blank line below `m.items` as still being
      // inside that (already-closed) dot expression.
      const doc = makeDocument(['sub init()', '  for each item in m.items', '    ', '  end for', 'end sub'].join('\n'));
      expect(getReceiverNameAtPosition(doc, { line: 2, character: 4 })).to.be.null;
    });
  });

  describe('isDotAccessAtPosition', () => {
    it('is true right after a plain dot', () => {
      const doc = makeDocument('myArr.');
      expect(isDotAccessAtPosition(doc, { line: 0, character: 6 })).to.be.true;
    });

    it('is true for a complex receiver even though the name cannot be resolved', () => {
      // foo(). is a genuine dot-access context — the caller should suppress
      // default completions here, even though there's no simple receiver name.
      const doc = makeDocument('foo().');
      expect(isDotAccessAtPosition(doc, { line: 0, character: 6 })).to.be.true;
    });

    it('is true for an index-expression receiver', () => {
      const doc = makeDocument('arr[0].');
      expect(isDotAccessAtPosition(doc, { line: 0, character: 7 })).to.be.true;
    });

    it('is false when not after a dot', () => {
      const doc = makeDocument('x = 1');
      expect(isDotAccessAtPosition(doc, { line: 0, character: 5 })).to.be.false;
    });

    it('is false for @attr access', () => {
      const doc = makeDocument('node@width');
      expect(isDotAccessAtPosition(doc, { line: 0, character: 10 })).to.be.false;
    });
  });

  describe('findAssignedConstructor', () => {
    it('finds the constructor a variable was assigned from', () => {
      const doc = makeDocument('sub init()\n  a = ClassA()\n  a.c()\nend sub');
      expect(findAssignedConstructor(doc, 2, 'a')).to.equal('ClassA');
    });

    it('picks the nearest preceding assignment when reassigned', () => {
      const doc = makeDocument('sub init()\n  a = ClassA()\n  a = ClassB()\n  a.c()\nend sub');
      expect(findAssignedConstructor(doc, 3, 'a')).to.equal('ClassB');
    });

    it('does not leak an assignment from an unrelated sibling function (the old regex-based version scanned the whole file blindly)', () => {
      const doc = makeDocument([
        'sub one()',
        '  a = ClassA()',
        'end sub',
        'sub two()',
        '  a.c()',
        'end sub',
      ].join('\n'));
      expect(findAssignedConstructor(doc, 4, 'a')).to.be.null;
    });

    it('sees an outer function\'s assignment via closure', () => {
      const doc = makeDocument([
        'sub outer()',
        '  a = ClassA()',
        '  inner = function()',
        '    a.c()',
        '  end function',
        'end sub',
      ].join('\n'));
      expect(findAssignedConstructor(doc, 3, 'a')).to.equal('ClassA');
    });

    it('beforeLine excludes an assignment on the cursor\'s own line', () => {
      const doc = makeDocument('sub init()\n  a = ClassA()\nend sub');
      expect(findAssignedConstructor(doc, 1, 'a', { beforeLine: true })).to.be.null;
      expect(findAssignedConstructor(doc, 1, 'a')).to.equal('ClassA');
    });

    it('returns null when the value is not a call (e.g. a literal)', () => {
      const doc = makeDocument('sub init()\n  a = 5\n  a.c()\nend sub');
      expect(findAssignedConstructor(doc, 2, 'a')).to.be.null;
    });

    it('returns null when the variable was never assigned', () => {
      const doc = makeDocument('sub init()\n  a.c()\nend sub');
      expect(findAssignedConstructor(doc, 1, 'a')).to.be.null;
    });
  });
});
