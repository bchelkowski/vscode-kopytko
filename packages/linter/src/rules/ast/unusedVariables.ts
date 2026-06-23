import type { RuleDefinition } from '../../types';
import { checkUnusedVariablesAst } from './legacyRules';

export { checkUnusedVariablesAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/unused-variable',
  defaultSeverity: 'warning',
  fn: checkUnusedVariablesAst,
};
