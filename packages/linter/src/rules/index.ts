import type { RuleDefinition } from '../types';
import { trailingCommaSyntaxRule } from './syntaxRules';
import { AST_RULES } from './ast';

/** All rule groups — syntax prechecks plus AST-based rules. */
export const ALL_RULE_GROUPS: RuleDefinition[] = [
  ...AST_RULES.slice(0, 11),
  trailingCommaSyntaxRule,
  ...AST_RULES.slice(11),
];
