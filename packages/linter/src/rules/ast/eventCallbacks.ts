import type { RuleDefinition } from '../../types';
import { checkEventCallbacksAst } from './legacyRules';

export { checkEventCallbacksAst };

export const descriptor: RuleDefinition = {
  code: 'callback/undefined-event-callback',
  defaultSeverity: 'error',
  fn: checkEventCallbacksAst,
};
