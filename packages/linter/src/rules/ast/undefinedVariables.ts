import type { RuleDefinition } from '../../types';
import { checkUndefinedVariablesAst } from './legacyRules';

export { checkUndefinedVariablesAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/undefined-variable',
  defaultSeverity: 'error',
  fn: checkUndefinedVariablesAst,
};
