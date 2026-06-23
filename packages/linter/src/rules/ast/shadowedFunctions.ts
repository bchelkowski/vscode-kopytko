import type { RuleDefinition } from '../../types';
import { checkShadowedFunctionsAst } from './legacyRules';

export { checkShadowedFunctionsAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/shadows-function',
  defaultSeverity: 'error',
  fn: checkShadowedFunctionsAst,
};
