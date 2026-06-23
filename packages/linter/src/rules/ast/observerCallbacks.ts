import type { RuleDefinition } from '../../types';
import { checkObserverCallbacksAst } from './legacyRules';

export { checkObserverCallbacksAst };

export const descriptor: RuleDefinition = {
  code: 'callback/undefined-observer-callback',
  defaultSeverity: 'error',
  fn: checkObserverCallbacksAst,
};
