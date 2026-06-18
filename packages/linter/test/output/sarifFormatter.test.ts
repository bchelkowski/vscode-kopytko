import { expect } from 'chai';
import { formatSarif } from '../../src/output/sarifFormatter';
import { DEFAULT_RULE_CONFIG } from '../../src/config';
import type { LintResult } from '../../src/types';

function makeResult(overrides: Partial<LintResult> = {}): LintResult {
  return {
    diagnostics: [],
    fileCount: 1,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    hintCount: 0,
    ...overrides,
  };
}

function parseSarif(output: string) {
  return JSON.parse(output);
}

function rulesArray(output: string): { id: string; defaultConfiguration: { level: string }; shortDescription: { text: string } }[] {
  return parseSarif(output).runs[0].tool.driver.rules;
}

function resultsArray(output: string): { ruleId: string; level: string }[] {
  return parseSarif(output).runs[0].results;
}

describe('formatSarif', () => {
  describe('rules section', () => {
    it('uses DEFAULT_RULE_CONFIG when no configRules supplied', () => {
      const output = formatSarif(makeResult());
      const rules = rulesArray(output);
      const dup = rules.find(r => r.id === 'import/duplicate');
      expect(dup).to.exist;
      expect(dup!.defaultConfiguration.level).to.equal('warning');
    });

    it('reflects overridden severity in rules section', () => {
      const output = formatSarif(makeResult(), undefined, { 'identifier/undefined-function': 'warning' });
      const rules = rulesArray(output);
      const rule = rules.find(r => r.id === 'identifier/undefined-function');
      expect(rule).to.exist;
      expect(rule!.defaultConfiguration.level).to.equal('warning');
    });

    it('omits off rules from rules section', () => {
      const output = formatSarif(makeResult(), undefined, { 'import/duplicate': 'off' });
      const rules = rulesArray(output);
      expect(rules.find(r => r.id === 'import/duplicate')).to.be.undefined;
    });

    it('omits all off rules when entire config has only off entries', () => {
      const output = formatSarif(makeResult(), undefined, { 'import/duplicate': 'off', 'import/unresolved': 'off' });
      const rules = rulesArray(output);
      expect(rules.find(r => r.id === 'import/duplicate')).to.be.undefined;
      expect(rules.find(r => r.id === 'import/unresolved')).to.be.undefined;
    });

    it('maps info severity to note in defaultConfiguration', () => {
      const output = formatSarif(makeResult(), undefined, { 'import/build-generated': 'info' });
      const rules = rulesArray(output);
      const rule = rules.find(r => r.id === 'import/build-generated');
      expect(rule!.defaultConfiguration.level).to.equal('note');
    });
  });

  describe('results section', () => {
    it('maps error severity to error level', () => {
      const result = makeResult({
        diagnostics: [{ code: 'identifier/undefined-function', message: 'x', severity: 'error', line: 0, column: 0, filePath: '/a.brs' }],
        errorCount: 1,
      });
      const output = formatSarif(result);
      expect(resultsArray(output)[0].level).to.equal('error');
    });

    it('maps warning severity to warning level', () => {
      const result = makeResult({
        diagnostics: [{ code: 'import/duplicate', message: 'x', severity: 'warning', line: 0, column: 0, filePath: '/a.brs' }],
        warningCount: 1,
      });
      const output = formatSarif(result);
      expect(resultsArray(output)[0].level).to.equal('warning');
    });

    it('maps info severity to note level', () => {
      const result = makeResult({
        diagnostics: [{ code: 'import/build-generated', message: 'x', severity: 'info', line: 0, column: 0, filePath: '/a.brs' }],
        infoCount: 1,
      });
      const output = formatSarif(result);
      expect(resultsArray(output)[0].level).to.equal('note');
    });

    it('maps hint severity to note level', () => {
      const result = makeResult({
        diagnostics: [{ code: 'identifier/unused-parameter', message: 'x', severity: 'hint', line: 0, column: 0, filePath: '/a.brs' }],
        hintCount: 1,
      });
      const output = formatSarif(result);
      expect(resultsArray(output)[0].level).to.equal('note');
    });

    it('converts 0-based line/column to 1-based in region', () => {
      const result = makeResult({
        diagnostics: [{ code: 'identifier/undefined-function', message: 'x', severity: 'error', line: 4, column: 2, filePath: '/a.brs' }],
        errorCount: 1,
      });
      const sarif = parseSarif(formatSarif(result));
      const region = sarif.runs[0].results[0].locations[0].physicalLocation.region;
      expect(region.startLine).to.equal(5);
      expect(region.startColumn).to.equal(3);
    });

    it('rules and results agree on level for overridden severity', () => {
      const result = makeResult({
        diagnostics: [{ code: 'identifier/undefined-function', message: 'x', severity: 'warning', line: 0, column: 0, filePath: '/a.brs' }],
        warningCount: 1,
      });
      const output = formatSarif(result, undefined, { 'identifier/undefined-function': 'warning' });
      const rule = rulesArray(output).find(r => r.id === 'identifier/undefined-function');
      expect(rule!.defaultConfiguration.level).to.equal('warning');
      expect(resultsArray(output)[0].level).to.equal('warning');
    });
  });

  describe('rule descriptions', () => {
    const ALL_RULE_CODES = Object.keys(DEFAULT_RULE_CONFIG);

    it('provides non-fallback descriptions for all rules in DEFAULT_RULE_CONFIG', () => {
      const output = formatSarif(makeResult());
      const rules = rulesArray(output);
      for (const code of ALL_RULE_CODES) {
        const rule = rules.find(r => r.id === code);
        if (!rule) continue;
        expect(rule.shortDescription.text, `rule ${code} uses code as fallback description`).to.not.equal(code);
      }
    });

    it('provides description for import/missing-promise-deps', () => {
      const output = formatSarif(makeResult(), undefined, { 'import/missing-promise-deps': 'warning' });
      const rule = rulesArray(output).find(r => r.id === 'import/missing-promise-deps');
      expect(rule!.shortDescription.text).to.not.equal('import/missing-promise-deps');
    });

    it('provides description for identifier/unused-variable', () => {
      const output = formatSarif(makeResult(), undefined, { 'identifier/unused-variable': 'warning' });
      const rule = rulesArray(output).find(r => r.id === 'identifier/unused-variable');
      expect(rule!.shortDescription.text).to.not.equal('identifier/unused-variable');
    });

    it('provides description for callback/undefined-observer-callback', () => {
      const output = formatSarif(makeResult(), undefined, { 'callback/undefined-observer-callback': 'error' });
      const rule = rulesArray(output).find(r => r.id === 'callback/undefined-observer-callback');
      expect(rule!.shortDescription.text).to.not.equal('callback/undefined-observer-callback');
    });
  });

  describe('SARIF structure', () => {
    it('produces valid SARIF 2.1.0 structure', () => {
      const sarif = parseSarif(formatSarif(makeResult()));
      expect(sarif.version).to.equal('2.1.0');
      expect(sarif.runs).to.be.an('array').with.length(1);
      expect(sarif.runs[0].tool.driver.name).to.equal('kopytko-linter');
    });

    it('uses relative path from projectRoot in artifactLocation', () => {
      const result = makeResult({
        diagnostics: [{ code: 'import/duplicate', message: 'x', severity: 'warning', line: 0, column: 0, filePath: '/project/src/foo.brs' }],
        warningCount: 1,
      });
      const sarif = parseSarif(formatSarif(result, '/project'));
      const uri = sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
      expect(uri).to.equal('src/foo.brs');
    });
  });
});
