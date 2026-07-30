import { expect } from 'chai';
import { formatBodyForEditor, tryFormatXml } from '../../src/client/webview/bodyFormat';

describe('webview/bodyFormat', () => {
  describe('formatBodyForEditor', () => {
    it('pretty-prints JSON and picks the json language id', () => {
      const { content, language } = formatBodyForEditor('{"a":1,"b":[true,null]}', 'application/json');
      expect(language).to.equal('json');
      expect(content).to.equal('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
    });

    it('pretty-prints JSON even under a non-JSON content type (same rule as the Formatted tab)', () => {
      const { language } = formatBodyForEditor('{"a":1}', 'text/plain');
      expect(language).to.equal('json');
    });

    it('reindents XML and picks the xml language id', () => {
      const { content, language } = formatBodyForEditor('<root><child>x</child><child>y</child></root>', 'application/xml');
      expect(language).to.equal('xml');
      // One-line elements sit as siblings — no staircase.
      expect(content).to.equal('<root>\n  <child>x</child>\n  <child>y</child>\n</root>');
    });

    it('passes HTML through unindented with the html language id', () => {
      const html = '<!doctype html><body><p>hi</p></body>';
      const { content, language } = formatBodyForEditor(html, 'text/html; charset=utf-8');
      expect(language).to.equal('html');
      expect(content).to.equal(html);
    });

    it('falls back to plaintext for anything else', () => {
      const { content, language } = formatBodyForEditor('just some text', 'text/plain');
      expect(language).to.equal('plaintext');
      expect(content).to.equal('just some text');
    });

    it('treats truncated (invalid) JSON as plaintext instead of throwing', () => {
      const { language } = formatBodyForEditor('{"a": 1, "b": [tru', 'application/json');
      expect(language).to.equal('plaintext');
    });
  });

  describe('tryFormatXml', () => {
    it('returns null for text that does not start with <', () => {
      expect(tryFormatXml('not xml')).to.equal(null);
    });

    it('does not indent declarations or self-closing tags deeper', () => {
      const out = tryFormatXml('<?xml version="1.0"?><a><b/><c>x</c></a>');
      expect(out).to.equal('<?xml version="1.0"?>\n<a>\n  <b/>\n  <c>x</c>\n</a>');
    });
  });
});
