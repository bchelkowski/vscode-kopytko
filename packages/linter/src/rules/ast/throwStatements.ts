import type { RuleDefinition } from '../../types';
import { checkThrowStatementsAst } from './legacyRules';

export { checkThrowStatementsAst };

export const descriptor: RuleDefinition = {
  code: 'throw/*',
  defaultSeverity: 'warning',
  fn: checkThrowStatementsAst,
};
