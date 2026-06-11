import { expect } from 'chai';
import { parseJsonc } from '../src/jsonc';

describe('parseJsonc', () => {
  it('parses plain JSON without comments', () => {
    const result = parseJsonc('{ "a": 1, "b": "hello" }');
    expect(result).to.deep.equal({ a: 1, b: 'hello' });
  });

  it('strips full-line // comments', () => {
    const result = parseJsonc('{\n  // this is a comment\n  "a": 1\n}');
    expect(result).to.deep.equal({ a: 1 });
  });

  it('strips inline // comments', () => {
    const result = parseJsonc('{\n  "a": 1, // inline comment\n  "b": 2\n}');
    expect(result).to.deep.equal({ a: 1, b: 2 });
  });

  it('strips block /* */ comments', () => {
    const result = parseJsonc('{\n  /* block comment */\n  "a": 1\n}');
    expect(result).to.deep.equal({ a: 1 });
  });

  it('strips multi-line block comments', () => {
    const result = parseJsonc('{\n  /*\n   * multi-line\n   */\n  "a": 1\n}');
    expect(result).to.deep.equal({ a: 1 });
  });

  it('removes trailing commas before }', () => {
    const result = parseJsonc('{ "a": 1, "b": 2, }');
    expect(result).to.deep.equal({ a: 1, b: 2 });
  });

  it('removes trailing commas before ]', () => {
    const result = parseJsonc('{ "items": [1, 2, 3,] }');
    expect(result).to.deep.equal({ items: [1, 2, 3] });
  });

  it('preserves // inside string literals', () => {
    const result = parseJsonc('{ "url": "http://example.com" }');
    expect(result).to.deep.equal({ url: 'http://example.com' });
  });

  it('preserves /* inside string literals', () => {
    const result = parseJsonc('{ "pattern": "/* not a comment */" }');
    expect(result).to.deep.equal({ pattern: '/* not a comment */' });
  });

  it('handles escaped quotes inside strings', () => {
    const result = parseJsonc('{ "msg": "say \\"hello\\"" }');
    expect(result).to.deep.equal({ msg: 'say "hello"' });
  });

  it('handles a realistic VS Code settings.json', () => {
    const input = `{
      // Editor settings
      "editor.tabSize": 2,
      "kopytko.format.indentSize": 2, // matches editor
      /* Formatting rules */
      "kopytko.format.endKeywordStyle": "spaced",
      "kopytko.format.trimTrailingWhitespace": true,
    }`;
    const result = parseJsonc(input);
    expect(result['kopytko.format.indentSize']).to.equal(2);
    expect(result['kopytko.format.endKeywordStyle']).to.equal('spaced');
    expect(result['kopytko.format.trimTrailingWhitespace']).to.equal(true);
  });
});
