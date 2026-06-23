import type { RuleDefinition } from '../../types';
import { checkImportsAst } from './legacyRules';

export { checkImportsAst };

export const descriptor: RuleDefinition = {
  code: 'import/*',
  defaultSeverity: 'error',
  fn: checkImportsAst,
};
