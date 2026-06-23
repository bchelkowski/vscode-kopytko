import type { RuleDefinition } from '../../types';
import { checkDuplicateFunctionsAst } from './legacyRules';

export { checkDuplicateFunctionsAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/duplicate-function',
  defaultSeverity: 'error',
  fn: checkDuplicateFunctionsAst,
};
