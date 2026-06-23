import type { RuleDefinition } from '../../types';
import { checkUndefinedCallsAst } from './legacyRules';

export { checkUndefinedCallsAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/undefined-function',
  defaultSeverity: 'error',
  fn: checkUndefinedCallsAst,
};
