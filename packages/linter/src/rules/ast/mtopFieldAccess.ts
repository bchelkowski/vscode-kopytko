import type { RuleDefinition } from '../../types';
import { checkMtopFieldAccessAst } from './legacyRules';

export { checkMtopFieldAccessAst };

export const descriptor: RuleDefinition = {
  code: 'mtop/undefined-field',
  defaultSeverity: 'warning',
  fn: checkMtopFieldAccessAst,
};
