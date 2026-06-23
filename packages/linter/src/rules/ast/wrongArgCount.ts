import type { RuleDefinition } from '../../types';
import { checkWrongArgCountAst } from './legacyRules';

export { checkWrongArgCountAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/wrong-arg-count',
  defaultSeverity: 'error',
  fn: checkWrongArgCountAst,
};
