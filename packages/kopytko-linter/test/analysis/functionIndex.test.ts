import { expect } from 'chai';
import { parseFunctionDefs } from '../../src/analysis/functionIndex';

describe('functionIndex', () => {
  describe('parseFunctionDefs', () => {
    it('parses a simple function definition', () => {
      const text = 'function myFunc()\n  return 1\nend function';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs).to.have.length(1);
      expect(defs[0].name).to.equal('myFunc');
      expect(defs[0].nameLower).to.equal('myfunc');
      expect(defs[0].line).to.equal(0);
      expect(defs[0].filePath).to.equal('/file.brs');
    });

    it('parses a sub definition', () => {
      const text = 'sub doThing()\nend sub';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].name).to.equal('doThing');
    });

    it('column points to start of function name', () => {
      const text = '  function myHelper()';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].column).to.equal(11);
    });

    it('parses multiple definitions', () => {
      const text = [
        'function alpha()',
        '  return 1',
        'end function',
        '',
        'sub beta()',
        'end sub',
      ].join('\n');
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs.map((d) => d.name)).to.deep.equal(['alpha', 'beta']);
      expect(defs[1].line).to.equal(4);
    });

    it('is case-insensitive for function/sub keyword', () => {
      const text = 'Function CamelFunc()\nEnd Function';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].name).to.equal('CamelFunc');
    });

    it('captures the full declaration line as signature (trimmed)', () => {
      const text = '  function greet(name as String) as String\n  return ""\nend function';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].signature).to.equal('function greet(name as String) as String');
    });

    it('captures sub signature too', () => {
      const text = 'sub doWork(items as Object)\nend sub';
      const defs = parseFunctionDefs(text, '/file.brs');
      expect(defs[0].signature).to.equal('sub doWork(items as Object)');
    });

    it('returns empty array for file with no definitions', () => {
      expect(parseFunctionDefs('x = 1\ny = 2', '/file.brs')).to.deep.equal([]);
    });

    it('does not parse anonymous functions (no name)', () => {
      const text = 'm.handler = function()\nend function';
      expect(parseFunctionDefs(text, '/file.brs')).to.deep.equal([]);
    });
  });
});
