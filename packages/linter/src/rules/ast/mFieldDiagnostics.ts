import {
  DotExpression, IdentifierExpression, walk, analyzeContext,
} from 'kopytko-brightscript-parser';
import type { ContextField, ContextAnalysis } from 'kopytko-brightscript-parser';
import type { LintDiagnostic, LintSeverity, RuleContext, RuleDefinition } from '../../types';

/** SceneGraph fields automatically set by the runtime — not user-assigned. */
const SGNODE_AUTO_FIELDS = new Set(['top', 'global', 'id', 'focusedchild', 'focusablewhenunfocused']);

function getContextAnalysis(ctx: RuleContext): ContextAnalysis | null {
  if (ctx.analysis?.contextAnalysis) return ctx.analysis.contextAnalysis;
  if (!ctx.parseResult) return null;
  return analyzeContext(ctx.parseResult.root);
}

function getDotExpressions(ctx: RuleContext): DotExpression[] {
  if (ctx.analysis?.dotExpressions) return ctx.analysis.dotExpressions;
  if (!ctx.parseResult) return [];
  const nodes: DotExpression[] = [];
  walk(ctx.parseResult.root, { visitDotExpression: node => { nodes.push(node); } });
  return nodes;
}

/**
 * Warn when `m.fieldName` is read but `fieldName` is never assigned anywhere
 * in this file. Catches typos in field names.
 */
export function checkMFieldUninitializedAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config } = ctx;
  if (config['m/uninitialized-field'] === 'off') return [];

  const contextAnalysis = getContextAnalysis(ctx);
  if (!contextAnalysis) return [];

  const contextFields = contextAnalysis.getAllFields();
  const assignedNames = new Set(contextFields.map(f => f.name));
  const writeKeys = new Set(contextFields.map(f => `${f.line}:${f.column}`));

  const diagnostics: LintDiagnostic[] = [];

  for (const expr of getDotExpressions(ctx)) {
    const obj = expr.object;
    if (!(obj instanceof IdentifierExpression) || obj.name.toLowerCase() !== 'm') continue;

    const fieldName = expr.member.toLowerCase();
    if (SGNODE_AUTO_FIELDS.has(fieldName)) continue;

    const token = expr.memberToken;
    if (!token) continue;

    if (writeKeys.has(`${token.line}:${token.column}`)) continue;

    if (!assignedNames.has(fieldName)) {
      diagnostics.push({
        severity: (config['m/uninitialized-field'] as LintSeverity) ?? 'warning',
        code: 'm/uninitialized-field',
        message: `\`m.${expr.member}\` is read but never assigned in this file.`,
        line: token.line, column: token.column,
        endLine: token.line, endColumn: token.column + expr.member.length,
        filePath,
      });
    }
  }

  return diagnostics;
}

/**
 * Warn when `m.fieldName` is assigned two or more distinct inferred types
 * (e.g. String in one function, Integer in another). Indicates a likely bug.
 */
export function checkMFieldInconsistentTypeAst(ctx: RuleContext): LintDiagnostic[] {
  const { filePath, config } = ctx;
  if (config['m/inconsistent-field-type'] === 'off') return [];

  const contextAnalysis = getContextAnalysis(ctx);
  if (!contextAnalysis) return [];

  const contextFields = contextAnalysis.getAllFields();

  const fieldData = new Map<string, { types: Set<string>; first: ContextField }>();
  for (const field of contextFields) {
    if (!field.typeName) continue;
    const entry = fieldData.get(field.name);
    if (!entry) {
      fieldData.set(field.name, { types: new Set([field.typeName]), first: field });
    } else {
      entry.types.add(field.typeName);
    }
  }

  const diagnostics: LintDiagnostic[] = [];

  for (const { types, first } of fieldData.values()) {
    if (types.size < 2) continue;
    diagnostics.push({
      severity: (config['m/inconsistent-field-type'] as LintSeverity) ?? 'warning',
      code: 'm/inconsistent-field-type',
      message: `\`m.${first.originalName}\` is assigned inconsistent types: ${[...types].join(', ')}.`,
      line: first.line, column: first.column,
      endLine: first.line, endColumn: first.column + first.originalName.length,
      filePath,
    });
  }

  return diagnostics;
}

export const uninitializedFieldDescriptor: RuleDefinition = {
  code: 'm/uninitialized-field',
  defaultSeverity: 'warning',
  fn: checkMFieldUninitializedAst,
};

export const inconsistentFieldTypeDescriptor: RuleDefinition = {
  code: 'm/inconsistent-field-type',
  defaultSeverity: 'warning',
  fn: checkMFieldInconsistentTypeAst,
};
