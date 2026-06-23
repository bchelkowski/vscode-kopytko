import type { RuleDefinition } from '../../types';
import { checkLoopFlowControlAst } from './legacyRules';

export { checkLoopFlowControlAst };

export const descriptor: RuleDefinition = {
  code: 'syntax/flow-outside-loop',
  defaultSeverity: 'error',
  fn: checkLoopFlowControlAst,
};
