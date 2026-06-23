import type { RuleDefinition } from '../../types';
import { checkUnreachableCodeAst } from './legacyRules';

export { checkUnreachableCodeAst };

export const descriptor: RuleDefinition = {
  code: 'syntax/unreachable-code',
  defaultSeverity: 'warning',
  fn: checkUnreachableCodeAst,
};
