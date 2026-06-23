import type { RuleDefinition } from '../../types';
import { checkTrailingCommaAst } from './legacyRules';

export { checkTrailingCommaAst };

export const descriptor: RuleDefinition = {
  code: 'syntax/trailing-comma',
  defaultSeverity: 'error',
  fn: checkTrailingCommaAst,
};
