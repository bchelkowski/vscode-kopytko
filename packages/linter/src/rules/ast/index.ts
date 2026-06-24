/** AST rule exports and descriptors. */
export { checkCreateObjectArgsAst, descriptor as createObjectArgsRule } from './createObjectArgs';
export { checkThrowStatementsAst, descriptor as throwStatementsRule } from './throwStatements';
export { checkLoopFlowControlAst, descriptor as loopFlowControlRule } from './loopFlowControl';
export { checkMissingTypeAnnotationsAst, descriptor as missingTypeAnnotationsRule } from './missingTypeAnnotations';
export { checkTrailingCommaAst, descriptor as trailingCommaRule } from './trailingComma';
export { checkShadowedBuiltinsAst, descriptor as shadowedBuiltinsRule } from './shadowedBuiltins';
export { checkShadowedFunctionsAst, descriptor as shadowedFunctionsRule } from './shadowedFunctions';
export { checkUnusedParametersAst, descriptor as unusedParametersRule } from './unusedParameters';
export { checkUnusedVariablesAst, descriptor as unusedVariablesRule } from './unusedVariables';
export { checkWrongArgCountAst, descriptor as wrongArgCountRule } from './wrongArgCount';
export { checkUndefinedCallsAst, descriptor as undefinedCallsRule } from './undefinedCalls';
export { checkUndefinedVariablesAst, descriptor as undefinedVariablesRule } from './undefinedVariables';
export { checkObserverCallbacksAst, descriptor as observerCallbacksRule } from './observerCallbacks';
export { checkTestFileStructureAst, descriptor as testFileStructureRule } from './testFileStructure';
export { checkEventCallbacksAst, descriptor as eventCallbacksRule } from './eventCallbacks';
export { checkImportsAst, descriptor as importsRule } from './imports';
export { checkDeadFunctionsAst, descriptor as deadFunctionsRule } from './deadFunctions';
export { checkLoopVariableLeakAst, descriptor as loopVariableLeakRule } from './loopVariableLeak';
export { checkDuplicateFunctionsAst, descriptor as duplicateFunctionsRule } from './duplicateFunctions';
export { checkMtopFieldAccessAst, descriptor as mtopFieldAccessRule } from './mtopFieldAccess';
export { checkUnreachableCodeAst, descriptor as unreachableCodeRule } from './unreachableCode';
export { checkMFieldUninitializedAst, uninitializedFieldDescriptor as mFieldUninitializedRule } from './mFieldDiagnostics';
export { checkMFieldInconsistentTypeAst, inconsistentFieldTypeDescriptor as mFieldInconsistentTypeRule } from './mFieldDiagnostics';

import { descriptor as createObjectArgsRule } from './createObjectArgs';
import { descriptor as throwStatementsRule } from './throwStatements';
import { descriptor as loopFlowControlRule } from './loopFlowControl';
import { descriptor as missingTypeAnnotationsRule } from './missingTypeAnnotations';
import { descriptor as shadowedBuiltinsRule } from './shadowedBuiltins';
import { descriptor as shadowedFunctionsRule } from './shadowedFunctions';
import { descriptor as unusedParametersRule } from './unusedParameters';
import { descriptor as unusedVariablesRule } from './unusedVariables';
import { descriptor as wrongArgCountRule } from './wrongArgCount';
import { descriptor as undefinedCallsRule } from './undefinedCalls';
import { descriptor as undefinedVariablesRule } from './undefinedVariables';
import { descriptor as observerCallbacksRule } from './observerCallbacks';
import { descriptor as testFileStructureRule } from './testFileStructure';
import { descriptor as eventCallbacksRule } from './eventCallbacks';
import { descriptor as importsRule } from './imports';
import { descriptor as deadFunctionsRule } from './deadFunctions';
import { descriptor as loopVariableLeakRule } from './loopVariableLeak';
import { descriptor as duplicateFunctionsRule } from './duplicateFunctions';
import { descriptor as mtopFieldAccessRule } from './mtopFieldAccess';
import { descriptor as unreachableCodeRule } from './unreachableCode';
import { uninitializedFieldDescriptor as mFieldUninitializedRule, inconsistentFieldTypeDescriptor as mFieldInconsistentTypeRule } from './mFieldDiagnostics';
import type { RuleDefinition } from '../../types';

export const AST_RULES: RuleDefinition[] = [
  importsRule,
  undefinedCallsRule,
  undefinedVariablesRule,
  shadowedBuiltinsRule,
  shadowedFunctionsRule,
  unusedParametersRule,
  unusedVariablesRule,
  deadFunctionsRule,
  wrongArgCountRule,
  throwStatementsRule,
  createObjectArgsRule,
  loopFlowControlRule,
  testFileStructureRule,
  missingTypeAnnotationsRule,
  observerCallbacksRule,
  eventCallbacksRule,
  loopVariableLeakRule,
  duplicateFunctionsRule,
  mtopFieldAccessRule,
  unreachableCodeRule,
  mFieldUninitializedRule,
  mFieldInconsistentTypeRule,
];
