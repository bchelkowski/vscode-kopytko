import { expect } from 'chai';
import {
  coerceFieldValue,
  diffTrees,
  domToLite,
  type LiteEl,
} from '../../src/client/nodes/webview/xmlDiff';

function el(tag: string, attrs: Record<string, string> = {}, children: LiteEl[] = []): LiteEl {
  return { tag, attrs, children };
}

/** Typical app-ui baseline: <screen> → Scene → children. */
function baseline(): LiteEl {
  return el('screen', {}, [
    el('MainScene', { name: 'root', _sn: '1', focusable: 'true' }, [
      el('Group', { name: 'content', _sn: '2' }, [
        el('Label', { name: 'title', _sn: '3', text: 'Hello', visible: 'true', opacity: '1.0' }),
        el('Poster', { name: 'logo', _sn: '4', uri: 'pkg:/images/a.png', translation: '[0.0,0.0]' }),
      ]),
    ]),
  ]);
}

describe('nodes/xmlDiff', () => {
  describe('diffTrees', () => {
    it('reports no edits for identical trees', () => {
      const result = diffTrees(baseline(), baseline());
      expect(result).to.deep.equal({ ok: true, edits: [] });
    });

    it('produces a field edit with the correct path for a changed attribute', () => {
      const edited = baseline();
      edited.children[0].children[0].children[0].attrs.text = 'Goodbye';

      const result = diffTrees(baseline(), edited);
      if (!result.ok) throw new Error(result.error);
      expect(result.edits).to.have.length(1);
      const [edit] = result.edits;
      expect(edit.path).to.deep.equal([0, 0, 0]);
      expect(edit.subtype).to.equal('Label');
      expect(edit.id).to.equal('title');
      expect(edit.field).to.equal('text');
      expect(edit.value).to.equal('Goodbye');
      expect(edit.wireValue).to.equal('Goodbye');
      expect(edit.steps).to.deep.equal([
        { subtype: 'MainScene', id: 'root', ordinal: 0 },
        { subtype: 'Group', id: 'content', ordinal: 0 },
        { subtype: 'Label', id: 'title', ordinal: 0 },
      ]);
    });

    it('computes same-subtype ordinals in steps', () => {
      const base = el('screen', {}, [
        el('MainScene', {}, [
          el('Label', { text: 'a' }),
          el('Poster', { uri: 'x' }),
          el('Label', { text: 'b' }),
        ]),
      ]);
      const edited = el('screen', {}, [
        el('MainScene', {}, [
          el('Label', { text: 'a' }),
          el('Poster', { uri: 'x' }),
          el('Label', { text: 'changed' }),
        ]),
      ]);
      const result = diffTrees(base, edited);
      if (!result.ok) throw new Error(result.error);
      expect(result.edits).to.have.length(1);
      // Second Label: ordinal 1 among Labels even though it is child #2.
      expect(result.edits[0].steps).to.deep.equal([
        { subtype: 'MainScene', id: undefined, ordinal: 0 },
        { subtype: 'Label', id: undefined, ordinal: 1 },
      ]);
    });

    it('collects multiple edits across nodes', () => {
      const edited = baseline();
      edited.children[0].children[0].children[0].attrs.visible = 'false';
      edited.children[0].children[0].children[1].attrs.uri = 'pkg:/images/b.png';

      const result = diffTrees(baseline(), edited);
      if (!result.ok) throw new Error(result.error);
      expect(result.edits.map(e => e.field).sort()).to.deep.equal(['uri', 'visible']);
      expect(result.edits.find(e => e.field === 'visible')!.wireValue).to.equal(false);
    });

    it('allows adding a new attribute (setField creates missing fields)', () => {
      const edited = baseline();
      edited.children[0].children[0].children[0].attrs.color = '0xFF0000FF';

      const result = diffTrees(baseline(), edited);
      if (!result.ok) throw new Error(result.error);
      expect(result.edits).to.have.length(1);
      expect(result.edits[0].field).to.equal('color');
      expect(result.edits[0].wireValue).to.equal('0xFF0000FF');
    });

    it('rejects removing an attribute', () => {
      const edited = baseline();
      delete edited.children[0].children[0].children[0].attrs.opacity;

      const result = diffTrees(baseline(), edited);
      expect(result.ok).to.be.false;
      if (result.ok) return;
      expect(result.error).to.match(/removing attribute "opacity"/);
    });

    it('rejects an added element with its location', () => {
      const edited = baseline();
      edited.children[0].children[0].children.push(el('Rectangle', {}));

      const result = diffTrees(baseline(), edited);
      expect(result.ok).to.be.false;
      if (result.ok) return;
      expect(result.error).to.match(/structural change not supported: 1 element\(s\) added/);
      expect(result.error).to.include('"content"');
    });

    it('rejects a removed element', () => {
      const edited = baseline();
      edited.children[0].children[0].children.pop();

      const result = diffTrees(baseline(), edited);
      expect(result.ok).to.be.false;
      if (result.ok) return;
      expect(result.error).to.match(/1 element\(s\) removed/);
    });

    it('rejects a renamed element', () => {
      const edited = baseline();
      edited.children[0].children[0].children[0].tag = 'SimpleLabel';

      const result = diffTrees(baseline(), edited);
      expect(result.ok).to.be.false;
      if (result.ok) return;
      expect(result.error).to.match(/renamed to <SimpleLabel>/);
    });

    it('rejects editing a synthetic/read-only attribute', () => {
      const edited = baseline();
      edited.children[0].children[0].children[0].attrs._sn = '999';

      const result = diffTrees(baseline(), edited);
      expect(result.ok).to.be.false;
      if (result.ok) return;
      expect(result.error).to.match(/"_sn" .* read-only/);
    });

    it('does not diff attributes on the container root itself', () => {
      const base = baseline();
      const edited = baseline();
      edited.attrs.whatever = 'x';
      const result = diffTrees(base, edited);
      expect(result).to.deep.equal({ ok: true, edits: [] });
    });
  });

  describe('coerceFieldValue', () => {
    it('types booleans from the baseline', () => {
      expect(coerceFieldValue('false', 'true')).to.equal(false);
      expect(coerceFieldValue('TRUE', 'false')).to.equal(true);
    });

    it('types numbers from the baseline', () => {
      expect(coerceFieldValue('0.5', '1.0')).to.equal(0.5);
      expect(coerceFieldValue('42', '7')).to.equal(42);
      expect(coerceFieldValue('-3.25', '0.0')).to.equal(-3.25);
    });

    it('types arrays from the baseline', () => {
      expect(coerceFieldValue('[10, 20]', '[0.0,0.0]')).to.deep.equal([10, 20]);
    });

    it('parses the app-ui curly vector format into a number array', () => {
      // app-ui prints vectors as `{x, y}`; SceneGraph silently ignores that
      // form when set as a string, so it must go over the wire as an array.
      expect(coerceFieldValue('{400, 100}', '{0, 0}')).to.deep.equal([400, 100]);
      expect(coerceFieldValue('{-1.5, 2}', '{0, 0}')).to.deep.equal([-1.5, 2]);
      expect(coerceFieldValue('{0, 0, 1920, 1080}', '{0, 0, 100, 100}'))
        .to.deep.equal([0, 0, 1920, 1080]);
    });

    it('accepts bracket input against a curly baseline and vice versa', () => {
      expect(coerceFieldValue('[70, 80]', '{0, 0}')).to.deep.equal([70, 80]);
      expect(coerceFieldValue('{70, 80}', '[0.0,0.0]')).to.deep.equal([70, 80]);
    });

    it('does not treat non-numeric curly text as a vector', () => {
      expect(coerceFieldValue('{key: 1}', '{key: 0}')).to.equal('{key: 1}');
      expect(coerceFieldValue('not-a-vector', '{0, 0}')).to.equal('not-a-vector');
    });

    it('keeps strings as strings even when the new value looks numeric', () => {
      expect(coerceFieldValue('123', 'Hello')).to.equal('123');
    });

    it('keeps colors as strings', () => {
      expect(coerceFieldValue('0x00FF00FF', '0xFF0000FF')).to.equal('0x00FF00FF');
    });

    it('falls back to the raw string when the new value no longer matches the baseline type', () => {
      expect(coerceFieldValue('not-a-number', '1.0')).to.equal('not-a-number');
      expect(coerceFieldValue('maybe', 'true')).to.equal('maybe');
    });

    it('infers from the new value for added attributes', () => {
      expect(coerceFieldValue('true')).to.equal(true);
      expect(coerceFieldValue('12')).to.equal(12);
      expect(coerceFieldValue('hello')).to.equal('hello');
    });
  });

  describe('domToLite', () => {
    it('adapts an Element-like structure', () => {
      const domish = {
        tagName: 'Label',
        attributes: [{ name: 'name', value: 'title' }, { name: 'text', value: 'Hi' }],
        children: [] as never[],
      };
      expect(domToLite(domish)).to.deep.equal({
        tag: 'Label',
        attrs: { name: 'title', text: 'Hi' },
        children: [],
      });
    });
  });
});
