import type { RuleDefinition } from '../types';
import { checkImports } from './importRules';
import { checkUndefinedCalls, checkUndefinedVariables, checkShadowedBuiltins, checkUnusedParameters } from './identifierRules';
import { checkThrowStatements, checkCreateObjectArgs, checkTrailingCommaSyntaxErrors, checkLoopFlowControl } from './syntaxRules';
import { checkTestFileStructure } from './testRules';
import { checkMissingTypeAnnotations } from './typeAnnotationRules';
import { checkObserverCallbacks, checkEventCallbacks } from './callbackRules';

/** All rule groups as single functions that check multiple codes internally. */
export const ALL_RULE_GROUPS: RuleDefinition[] = [
  { code: 'import/*', defaultSeverity: 'error', fn: checkImports },
  { code: 'identifier/undefined-function', defaultSeverity: 'error', fn: checkUndefinedCalls },
  { code: 'identifier/undefined-variable', defaultSeverity: 'error', fn: checkUndefinedVariables },
  { code: 'identifier/shadows-builtin', defaultSeverity: 'error', fn: checkShadowedBuiltins },
  { code: 'identifier/unused-parameter', defaultSeverity: 'hint', fn: checkUnusedParameters },
  { code: 'throw/*', defaultSeverity: 'warning', fn: checkThrowStatements },
  { code: 'createobject/unknown-component', defaultSeverity: 'warning', fn: checkCreateObjectArgs },
  { code: 'syntax/trailing-comma', defaultSeverity: 'error', fn: checkTrailingCommaSyntaxErrors },
  { code: 'syntax/flow-outside-loop', defaultSeverity: 'error', fn: checkLoopFlowControl },
  { code: 'test/*', defaultSeverity: 'warning', fn: checkTestFileStructure },
  { code: 'type/*', defaultSeverity: 'warning', fn: checkMissingTypeAnnotations },
  { code: 'callback/undefined-observer-callback', defaultSeverity: 'error', fn: checkObserverCallbacks },
  { code: 'callback/undefined-event-callback', defaultSeverity: 'error', fn: checkEventCallbacks },
];
