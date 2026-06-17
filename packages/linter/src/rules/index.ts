import type { RuleDefinition } from '../types';
import { checkTrailingCommaSyntaxErrors } from './syntaxRules';
import {
  checkCreateObjectArgsAst,
  checkThrowStatementsAst,
  checkLoopFlowControlAst,
  checkMissingTypeAnnotationsAst,
  checkShadowedBuiltinsAst,
  checkUnusedParametersAst,
  checkUnusedVariablesAst,
  checkWrongArgCountAst,
  checkUndefinedCallsAst,
  checkUndefinedVariablesAst,
  checkObserverCallbacksAst,
  checkTestFileStructureAst,
  checkEventCallbacksAst,
  checkImportsAst,
} from './astRules';

/** All rule groups — AST-based via brightscript-parser. */
export const ALL_RULE_GROUPS: RuleDefinition[] = [
  { code: 'import/*', defaultSeverity: 'error', fn: checkImportsAst },
  { code: 'identifier/undefined-function', defaultSeverity: 'error', fn: checkUndefinedCallsAst },
  { code: 'identifier/undefined-variable', defaultSeverity: 'error', fn: checkUndefinedVariablesAst },
  { code: 'identifier/shadows-builtin', defaultSeverity: 'error', fn: checkShadowedBuiltinsAst },
  { code: 'identifier/unused-parameter', defaultSeverity: 'hint', fn: checkUnusedParametersAst },
  { code: 'identifier/unused-variable', defaultSeverity: 'warning', fn: checkUnusedVariablesAst },
  { code: 'identifier/wrong-arg-count', defaultSeverity: 'error', fn: checkWrongArgCountAst },
  { code: 'throw/*', defaultSeverity: 'warning', fn: checkThrowStatementsAst },
  { code: 'createobject/unknown-component', defaultSeverity: 'warning', fn: checkCreateObjectArgsAst },
  { code: 'syntax/trailing-comma', defaultSeverity: 'error', fn: checkTrailingCommaSyntaxErrors },
  { code: 'syntax/flow-outside-loop', defaultSeverity: 'error', fn: checkLoopFlowControlAst },
  { code: 'test/*', defaultSeverity: 'warning', fn: checkTestFileStructureAst },
  { code: 'type/*', defaultSeverity: 'warning', fn: checkMissingTypeAnnotationsAst },
  { code: 'callback/undefined-observer-callback', defaultSeverity: 'error', fn: checkObserverCallbacksAst },
  { code: 'callback/undefined-event-callback', defaultSeverity: 'error', fn: checkEventCallbacksAst },
];
