import type { RuleDefinition } from '../types';
import { AST_RULES } from './ast';

/** All rule groups — every rule is now AST-based. */
export const ALL_RULE_GROUPS: RuleDefinition[] = AST_RULES;
