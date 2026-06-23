import type { RuleDefinition } from '../../types';
import { checkLoopVariableLeakAst } from './legacyRules';

export { checkLoopVariableLeakAst };

export const descriptor: RuleDefinition = {
  code: 'identifier/loop-variable-leak',
  defaultSeverity: 'warning',
  fn: checkLoopVariableLeakAst,
};
