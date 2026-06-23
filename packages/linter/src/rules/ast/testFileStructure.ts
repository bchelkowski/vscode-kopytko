import type { RuleDefinition } from '../../types';
import { checkTestFileStructureAst } from './legacyRules';

export { checkTestFileStructureAst };

export const descriptor: RuleDefinition = {
  code: 'test/*',
  defaultSeverity: 'warning',
  fn: checkTestFileStructureAst,
};
