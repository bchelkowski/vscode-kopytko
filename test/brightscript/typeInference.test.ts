import { expect } from 'chai';
import { parse, inferTypesFromAst, getVariableType } from 'kopytko-brightscript-parser';
import { getReceiverName, resolveReceiverType } from '../../src/server/brightscript/typeInference';

/** Helper: infer types using the parser and return a simple name→type map. */
function inferTypes(text: string): Map<string, string> {
  const result = parse(text);
  const typeMap = inferTypesFromAst(result.root);
  const simpleMap = new Map<string, string>();
  for (const [name] of typeMap) {
    const type = getVariableType(typeMap, name);
    if (type) simpleMap.set(name, type);
  }
  return simpleMap;
}

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

    it('single-quoted strings are comments in BrightScript (not valid string syntax)', () => {
      const map = inferTypes(`fs = CreateObject('roFileSystem')`);
      // BrightScript uses double quotes only — single quote starts a comment
      expect(map.get('fs')).to.be.undefined;
    });

    it('infers typed function parameters', () => {
      const map = inferTypes(`sub doWork(node as roSGNode)\nend sub`);
      expect(map.get('node')).to.equal('roSGNode');
    });

    it('infers typed parameters that also carry a default value', () => {
      const map = inferTypes(`function foo(arr = invalid as roArray) as Void\nend function`);
      expect(map.get('arr')).to.equal('roArray');
    });

    it('infers typed parameters with a numeric default value', () => {
      const map = inferTypes(`sub bar(count = 0 as Integer, node = invalid as roSGNode)\nend sub`);
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

    it('returns an empty map for files with no type-inferable assignments', () => {
      const map = inferTypes(`sub foo()\n  print "hello"\nend sub`);
      expect(map.size).to.equal(0);
    });

    it('handles whitespace variations around =', () => {
      const map = inferTypes(`myVar=CreateObject("roDateTime")`);
      expect(map.get('myvar')).to.equal('roDateTime');
    });

    // ── Numeric literal assignments ─────────────────────────────────────────

    it('infers Integer from a plain decimal literal', () => {
      const map = inferTypes(`x = 255`);
      expect(map.get('x')).to.equal('Integer');
    });

    it('infers Integer from a hex literal', () => {
      const map = inferTypes(`x = &HFF`);
      expect(map.get('x')).to.equal('Integer');
    });

    it('infers Integer from a lowercase hex literal', () => {
      const map = inferTypes(`x = &hff`);
      expect(map.get('x')).to.equal('Integer');
    });

    it('infers Float from a decimal point literal', () => {
      const map = inferTypes(`x = 2.01`);
      expect(map.get('x')).to.equal('Float');
    });

    it('infers Float from an E exponent literal', () => {
      const map = inferTypes(`x = 1.23456E+30`);
      expect(map.get('x')).to.equal('Float');
    });

    it('infers Float from a ! suffix literal', () => {
      const map = inferTypes(`x = 2!`);
      expect(map.get('x')).to.equal('Float');
    });

    it('infers Double from a D exponent literal', () => {
      const map = inferTypes(`x = 1.23456789D-12`);
      expect(map.get('x')).to.equal('Double');
    });

    it('infers Double from a # suffix literal', () => {
      const map = inferTypes(`x = 2.3#`);
      expect(map.get('x')).to.equal('Double');
    });

    it('infers LongInteger from a decimal with & suffix', () => {
      const map = inferTypes(`x = 9876543210&`);
      expect(map.get('x')).to.equal('LongInteger');
    });

    it('infers LongInteger from a hex with & suffix', () => {
      const map = inferTypes(`x = &hFEDCBA9876543210&`);
      expect(map.get('x')).to.equal('LongInteger');
    });

    it('infers m. member from numeric literal', () => {
      const map = inferTypes(`m.flags = &HFF`);
      expect(map.get('flags')).to.equal('Integer');
    });

    it('CreateObject binding wins over numeric literal for same variable', () => {
      const src = [
        `x = 42`,
        `x = CreateObject("roArray")`,
      ].join('\n');
      const map = inferTypes(src);
      expect(map.get('x')).to.equal('roArray');
    });

    it('numeric literal does not overwrite typed param', () => {
      const src = [
        `sub foo(x as roArray)`,
        `  x = 42`,
        `end sub`,
      ].join('\n');
      const map = inferTypes(src);
      // CreateObject/typed-param bindings take precedence
      expect(map.get('x')).to.equal('roArray');
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
