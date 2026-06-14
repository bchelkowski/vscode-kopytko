import { expect } from 'chai';
import { applySnippetCasing } from '../../src/server/brightscript/casingUtils';

describe('casingUtils', () => {
  describe('applySnippetCasing', () => {
    it('NoChange leaves snippet unchanged', () => {
      expect(applySnippetCasing('Push(${1:a as Dynamic})', 'NoChange'))
        .to.equal('Push(${1:a as Dynamic})');
    });

    it('LowerCase applies only to method name, not parameters', () => {
      expect(applySnippetCasing('Push(${1:a as Dynamic})', 'LowerCase'))
        .to.equal('push(${1:a as Dynamic})');
    });

    it('UpperCase applies only to method name', () => {
      expect(applySnippetCasing('SetUrl(${1:url as String})', 'UpperCase'))
        .to.equal('SETURL(${1:url as String})');
    });

    it('CamelCase applies only to method name', () => {
      expect(applySnippetCasing('SetUrl(${1:url as String})', 'CamelCase'))
        .to.equal('setUrl(${1:url as String})');
    });

    it('PascalCase applies only to method name', () => {
      expect(applySnippetCasing('setUrl(${1:url as String})', 'PascalCase'))
        .to.equal('SetUrl(${1:url as String})');
    });

    it('Capitalize applies only to method name', () => {
      expect(applySnippetCasing('GetToString()', 'Capitalize'))
        .to.equal('Gettostring()');
    });

    it('works for no-arg snippets', () => {
      expect(applySnippetCasing('Count()', 'LowerCase')).to.equal('count()');
      expect(applySnippetCasing('Count()', 'CamelCase')).to.equal('count()');
      expect(applySnippetCasing('Count()', 'PascalCase')).to.equal('Count()');
    });

    it('works for snippets without parentheses (keywords)', () => {
      expect(applySnippetCasing('for', 'UpperCase')).to.equal('FOR');
      expect(applySnippetCasing('for', 'PascalCase')).to.equal('For');
    });
  });
});
