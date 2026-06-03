import { expect } from 'chai';
import { inferTypes, getReceiverName, resolveReceiverType } from '../../src/server/brightscript/typeInference';

describe('typeInference', () => {

  // ── inferTypes ─────────────────────────────────────────────────────────────

  describe('inferTypes', () => {
    it('detects a basic CreateObject assignment', () => {
      const map = inferTypes(`myArr = CreateObject("roArray")`);
      expect(map.get('myarr')).to.equal('roArray');
    });

    it('is case-insensitive for variable names', () => {
      const map = inferTypes(`MyArr = CreateObject("roArray")`);
      expect(map.get('myarr')).to.equal('roArray');
    });

    it('preserves component name casing', () => {
      const map = inferTypes(`url = CreateObject("roUrlTransfer")`);
      expect(map.get('url')).to.equal('roUrlTransfer');
    });

    it('detects multiple assignments in the same file', () => {
      const src = [
        `arr = CreateObject("roArray")`,
        `sub init()`,
        `  xml = CreateObject("roXMLElement")`,
        `end sub`,
      ].join('\n');
      const map = inferTypes(src);
      expect(map.get('arr')).to.equal('roArray');
      expect(map.get('xml')).to.equal('roXMLElement');
    });

    it('detects m. member assignments', () => {
      const map = inferTypes(`m.transfer = CreateObject("roUrlTransfer")`);
      expect(map.get('transfer')).to.equal('roUrlTransfer');
    });

    it('handles CreateObject with extra constructor args', () => {
      const map = inferTypes(`sec = CreateObject("roRegistrySection", "MySection")`);
      expect(map.get('sec')).to.equal('roRegistrySection');
    });

    it('handles single-quoted strings in CreateObject', () => {
      const map = inferTypes(`fs = CreateObject('roFileSystem')`);
      expect(map.get('fs')).to.equal('roFileSystem');
    });

    it('infers typed function parameters', () => {
      const map = inferTypes(`sub doWork(node as roSGNode)\nend sub`);
      expect(map.get('node')).to.equal('roSGNode');
    });

    it('CreateObject binding wins over typed param binding for same name', () => {
      const src = [
        `sub doWork(arr as roList)`,
        `  arr = CreateObject("roArray")`,
        `end sub`,
      ].join('\n');
      const map = inferTypes(src);
      expect(map.get('arr')).to.equal('roArray');
    });

    it('returns an empty map for files with no CreateObject or typed params', () => {
      const map = inferTypes(`sub foo()\n  x = 1\nend sub`);
      expect(map.size).to.equal(0);
    });

    it('handles whitespace variations around =', () => {
      const map = inferTypes(`myVar=CreateObject("roDateTime")`);
      expect(map.get('myvar')).to.equal('roDateTime');
    });
  });

  // ── getReceiverName ────────────────────────────────────────────────────────

  describe('getReceiverName', () => {
    it('extracts the receiver before a dot', () => {
      expect(getReceiverName('myArr.', 6)).to.equal('myArr');
    });

    it('extracts the receiver from a longer line', () => {
      expect(getReceiverName('  myUrl.GetToString()', 9)).to.equal('myUrl');
    });

    it('handles m. receiver returning the field name', () => {
      // cursor right after the second dot: `m.transfer.`
      expect(getReceiverName('m.transfer.', 11)).to.equal('transfer');
    });

    it('returns null when cursor is not after a dot', () => {
      expect(getReceiverName('myArr', 5)).to.be.null;
    });

    it('returns null for an empty line', () => {
      expect(getReceiverName('', 0)).to.be.null;
    });

    it('returns null when only a dot is present with no identifier before it', () => {
      expect(getReceiverName('.', 1)).to.be.null;
    });
  });

  // ── resolveReceiverType ───────────────────────────────────────────────────

  describe('resolveReceiverType', () => {
    it('resolves a known variable', () => {
      const map = new Map([['myarr', 'roArray']]);
      expect(resolveReceiverType('myArr', map)).to.equal('roArray');
    });

    it('is case-insensitive', () => {
      const map = new Map([['myarr', 'roArray']]);
      expect(resolveReceiverType('MYARR', map)).to.equal('roArray');
    });

    it('returns undefined for unknown variables', () => {
      const map = new Map<string, string>();
      expect(resolveReceiverType('unknown', map)).to.be.undefined;
    });
  });
});
