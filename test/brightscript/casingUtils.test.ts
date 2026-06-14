import { expect } from 'chai';
import { applySnippetCasing } from '../../src/server/brightscript/casingUtils';

describe('casingUtils', () => {
  describe('applySnippetCasing', () => {
    it('preserve leaves snippet unchanged', () => {
      expect(applySnippetCasing('Push(${1:a as Dynamic})', 'preserve'))
        .to.equal('Push(${1:a as Dynamic})');
    });

    it('lower-case applies only to method name, not parameters', () => {
      expect(applySnippetCasing('Push(${1:a as Dynamic})', 'lower-case'))
        .to.equal('push(${1:a as Dynamic})');
    });

    it('upper-case applies only to method name', () => {
      expect(applySnippetCasing('SetUrl(${1:url as String})', 'upper-case'))
        .to.equal('SETURL(${1:url as String})');
    });

    it('camel-case applies only to method name', () => {
      expect(applySnippetCasing('SetUrl(${1:url as String})', 'camel-case'))
        .to.equal('setUrl(${1:url as String})');
    });

    it('pascal-case applies only to method name', () => {
      expect(applySnippetCasing('setUrl(${1:url as String})', 'pascal-case'))
        .to.equal('SetUrl(${1:url as String})');
    });

    it('Capitalize applies only to method name', () => {
      expect(applySnippetCasing('GetToString()', 'capitalize'))
        .to.equal('Gettostring()');
    });

    it('works for no-arg snippets', () => {
      expect(applySnippetCasing('Count()', 'lower-case')).to.equal('count()');
      expect(applySnippetCasing('Count()', 'camel-case')).to.equal('count()');
      expect(applySnippetCasing('Count()', 'pascal-case')).to.equal('Count()');
    });

    it('works for snippets without parentheses (keyword)', () => {
      expect(applySnippetCasing('for', 'upper-case')).to.equal('FOR');
      expect(applySnippetCasing('for', 'pascal-case')).to.equal('For');
    });
  });
});
