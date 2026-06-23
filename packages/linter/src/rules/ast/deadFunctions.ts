import type { RuleDefinition } from '../../types';
import { checkDeadFunctionsAst } from './legacyRules';

export { checkDeadFunctionsAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/unused-function',
  defaultSeverity: 'hint',
  fn: checkDeadFunctionsAst,
};
