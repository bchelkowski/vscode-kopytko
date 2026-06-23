import type { RuleDefinition } from '../../types';
import { checkUnusedParametersAst } from './legacyRules';

export { checkUnusedParametersAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/unused-parameter',
  defaultSeverity: 'hint',
  fn: checkUnusedParametersAst,
};
