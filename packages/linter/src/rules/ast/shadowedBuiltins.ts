import type { RuleDefinition } from '../../types';
import { checkShadowedBuiltinsAst } from './legacyRules';

export { checkShadowedBuiltinsAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/shadows-builtin',
  defaultSeverity: 'error',
  fn: checkShadowedBuiltinsAst,
};
