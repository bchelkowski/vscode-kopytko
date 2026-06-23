import type { RuleDefinition } from '../../types';
import { checkCreateObjectArgsAst } from './legacyRules';

export { checkCreateObjectArgsAst };

export const descriptor: RuleDefinition = {
  code: 'createobject/unknown-component',
  defaultSeverity: 'warning',
  fn: checkCreateObjectArgsAst,
};
