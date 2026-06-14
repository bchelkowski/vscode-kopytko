import { expect } from 'chai';
import { parseLinterConfig, DEFAULT_LINTER_CONFIG, DEFAULT_RULE_CONFIG } from '../src/config';

describe('config', () => {
  describe('DEFAULT_RULE_CONFIG', () => {
    it('has 23 rules defined', () => {
      const ruleCount = Object.keys(DEFAULT_RULE_CONFIG).length;
      expect(ruleCount).to.equal(23);
    });

    it('includes all import rules', () => {
      const importRules = Object.keys(DEFAULT_RULE_CONFIG).filter(k => k.startsWith('import/'));
      expect(importRules).to.have.lengthOf(7);
    });

    it('includes all identifier rules', () => {
      const idRules = Object.keys(DEFAULT_RULE_CONFIG).filter(k => k.startsWith('identifier/'));
      expect(idRules).to.have.lengthOf(5);
    });

    it('includes throw, createobject, syntax, and test rules', () => {
      expect(DEFAULT_RULE_CONFIG).to.have.property('throw/invalid-value');
      expect(DEFAULT_RULE_CONFIG).to.have.property('throw/missing-message');
      expect(DEFAULT_RULE_CONFIG).to.have.property('createobject/unknown-component');
      expect(DEFAULT_RULE_CONFIG).to.have.property('syntax/trailing-comma');
      expect(DEFAULT_RULE_CONFIG).to.have.property('syntax/flow-outside-loop');
      expect(DEFAULT_RULE_CONFIG).to.have.property('test/missing-mock-annotation');
      expect(DEFAULT_RULE_CONFIG).to.have.property('test/missing-return-ts');
    });
  });

  describe('DEFAULT_LINTER_CONFIG', () => {
    it('has default sourceDir of "src"', () => {
      expect(DEFAULT_LINTER_CONFIG.sourceDir).to.equal('src');
    });

    it('has resolveModules true by default', () => {
      expect(DEFAULT_LINTER_CONFIG.resolveModules).to.equal(true);
    });

    it('has empty arrays for generatedPaths, generatedModules, and siblingPatterns', () => {
      expect(DEFAULT_LINTER_CONFIG.generatedPaths).to.be.an('array').that.is.empty;
      expect(DEFAULT_LINTER_CONFIG.generatedModules).to.be.an('array').that.is.empty;
      expect(DEFAULT_LINTER_CONFIG.siblingPatterns).to.be.an('array').that.is.empty;
    });
  });

  describe('parseLinterConfig', () => {
    it('returns default config when given an empty object', () => {
      const config = parseLinterConfig({});
      expect(config.sourceDir).to.equal('src');
      expect(config.resolveModules).to.equal(true);
      expect(Object.keys(config.rules).length).to.equal(23);
    });

    it('overrides a rule severity', () => {
      const config = parseLinterConfig({
        rules: { 'import/duplicate': 'warning' },
      });
      expect(config.rules['import/duplicate']).to.equal('warning');
      // Other rules should still have defaults
      expect(config.rules['import/unresolved']).to.equal('error');
    });

    it('allows turning a rule off', () => {
      const config = parseLinterConfig({
        rules: { 'import/duplicate': 'off' },
      });
      expect(config.rules['import/duplicate']).to.equal('off');
    });

    it('ignores invalid severity values', () => {
      const config = parseLinterConfig({
        rules: { 'import/duplicate': 'critical' },
      });
      // Should remain the default since 'critical' is not valid
      expect(config.rules['import/duplicate']).to.equal('warning');
    });

    it('overrides sourceDir', () => {
      const config = parseLinterConfig({ sourceDir: 'lib' });
      expect(config.sourceDir).to.equal('lib');
    });

    it('overrides resolveModules', () => {
      const config = parseLinterConfig({ resolveModules: false });
      expect(config.resolveModules).to.equal(false);
    });

    it('overrides generatedPaths', () => {
      const config = parseLinterConfig({ generatedPaths: ['/gen/**'] });
      expect(config.generatedPaths).to.deep.equal(['/gen/**']);
    });

    it('overrides generatedModules', () => {
      const modules = [{ path: '/gen/Api.brs', functions: ['apiCall'] }];
      const config = parseLinterConfig({ generatedModules: modules });
      expect(config.generatedModules).to.deep.equal(modules);
    });

    it('overrides siblingPatterns', () => {
      const patterns = [['**/*View.brs', '**/*ViewModel.brs']];
      const config = parseLinterConfig({ siblingPatterns: patterns });
      expect(config.siblingPatterns).to.deep.equal(patterns);
    });

    it('ignores non-object rules field', () => {
      const config = parseLinterConfig({ rules: 'invalid' });
      expect(Object.keys(config.rules).length).to.equal(23);
    });
  });
});
