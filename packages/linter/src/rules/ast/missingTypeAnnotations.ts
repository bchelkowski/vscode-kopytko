import type { RuleDefinition } from '../../types';
import { checkMissingTypeAnnotationsAst } from './legacyRules';

export { checkMissingTypeAnnotationsAst };

export const descriptor: RuleDefinition = {
  code: 'type/*',
  defaultSeverity: 'warning',
  fn: checkMissingTypeAnnotationsAst,
};
