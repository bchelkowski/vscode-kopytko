import type { LintDiagnostic, RuleContext } from '../types';
import { findComponent } from 'kopytko-brightscript-parser';
import { isNumericLiteral } from '../analysis/numericLiterals';

export function checkThrowStatements(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;
  if (config['throw/invalid-value'] === 'off' && config['throw/missing-message'] === 'off') return [];

  const diagnostics: LintDiagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    const throwMatch = /^\s*throw\b\s+(.+?)(?:\s*'.*)?$/i.exec(raw);
    if (!throwMatch) continue;

    let expr = throwMatch[1].trim();

    if (expr.startsWith('(') && expr.endsWith(')')) {
      let depth = 0;
      let isOuterWrapped = true;
      for (let i = 0; i < expr.length - 1; i++) {
        if (expr[i] === '(') depth++;
        else if (expr[i] === ')') {
          depth--;
          if (depth === 0) { isOuterWrapped = false; break; }
        }
      }
      if (isOuterWrapped) expr = expr.slice(1, -1).trim();
    }

    const throwKeywordStart = raw.search(/\bthrow\b/i);
    const throwRange = {
      line: lineIdx,
      column: throwKeywordStart,
      endLine: lineIdx,
      endColumn: throwKeywordStart + 5,
      filePath,
    };

    if (config['throw/invalid-value'] !== 'off') {
      if (isNumericLiteral(expr)) {
        diagnostics.push({
          severity: config['throw/invalid-value'] ?? 'warning',
          code: 'throw/invalid-value',
          message: '`throw` requires a string or an associative array with a "message" field — numeric literals are not valid throw values.',
          ...throwRange,
        });
        continue;
      }

      if (expr.startsWith('[')) {
        diagnostics.push({
          severity: config['throw/invalid-value'] ?? 'warning',
          code: 'throw/invalid-value',
          message: '`throw` requires a string or an associative array with a "message" field — array literals are not valid throw values.',
          ...throwRange,
        });
        continue;
      }

      if (/^invalid$/i.test(expr)) {
        diagnostics.push({
          severity: config['throw/invalid-value'] ?? 'warning',
          code: 'throw/invalid-value',
          message: '`throw` requires a string or an associative array with a "message" field — `invalid` is not a valid throw value.',
          ...throwRange,
        });
        continue;
      }
    }

    if (config['throw/missing-message'] !== 'off') {
      if (expr.startsWith('{') && expr.endsWith('}')) {
        if (!/\bmessage\s*:/i.test(expr)) {
          diagnostics.push({
            severity: config['throw/missing-message'] ?? 'warning',
            code: 'throw/missing-message',
            message: 'Thrown associative array should include a "message" field (e.g. `{ message: "error description", number: -1 }`).',
            ...throwRange,
          });
        }
      }
    }
  }

  return diagnostics;
}

const CREATE_OBJECT_ARG_RE = /\bCreateObject\s*\(\s*"([^"]*)"/gi;

export function checkCreateObjectArgs(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;
  if (config['createobject/unknown-component'] === 'off') return [];

  const diagnostics: LintDiagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    CREATE_OBJECT_ARG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CREATE_OBJECT_ARG_RE.exec(raw)) !== null) {
      const componentName = match[1];
      if (!componentName) continue;
      if (componentName.toLowerCase() === 'rosgnode') continue;

      if (!findComponent(componentName)) {
        const argStart = raw.indexOf(`"${componentName}"`, match.index);
        if (argStart < 0) continue;
        diagnostics.push({
          severity: config['createobject/unknown-component'] ?? 'warning',
          code: 'createobject/unknown-component',
          message: `Unknown BrightScript component "${componentName}". Check the component name spelling.`,
          line: lineIdx,
          column: argStart,
          endLine: lineIdx,
          endColumn: argStart + componentName.length + 2,
          filePath,
        });
      }
    }
  }

  return diagnostics;
}

export function checkTrailingCommaSyntaxErrors(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;
  if (config['syntax/trailing-comma'] === 'off') return [];

  const diagnostics: LintDiagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    const returnCommaMatch = /^\s*return\b\s+.+,\s*$/.exec(raw);
    if (returnCommaMatch) {
      const commaPos = raw.lastIndexOf(',');
      diagnostics.push({
        severity: config['syntax/trailing-comma'] ?? 'error',
        code: 'syntax/trailing-comma',
        message: 'Trailing comma after return value is a syntax error — the code will not compile.',
        line: lineIdx,
        column: commaPos,
        endLine: lineIdx,
        endColumn: commaPos + 1,
        filePath,
      });
    }
  }

  return diagnostics;
}

function popUntil(stack: string[], target: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] === target) {
      stack.splice(i, 1);
      return;
    }
  }
}

export function checkLoopFlowControl(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config } = ctx;
  if (config['syntax/flow-outside-loop'] === 'off') return [];

  const diagnostics: LintDiagnostic[] = [];
  const stack: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;
    const trimmed = raw.replace(/'.*$/, '').trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();

    if (/^for\b/i.test(lower)) {
      stack.push('for');
    } else if (/^while\b/i.test(lower)) {
      stack.push('while');
    } else if (/^(?:sub|function)\b/i.test(lower) && /\(/i.test(lower)) {
      stack.push('other');
    } else if (/^(?:if)\b/i.test(lower) && /\bthen\s*$/i.test(lower)) {
      stack.push('other');
    } else if (/^(?:try)\b/i.test(lower)) {
      stack.push('other');
    }

    if (/^end\s*for\b/i.test(lower) || /^endfor\b/i.test(lower) || /^next\b/i.test(lower)) {
      popUntil(stack, 'for');
    } else if (/^end\s*while\b/i.test(lower) || /^endwhile\b/i.test(lower)) {
      popUntil(stack, 'while');
    } else if (/^end\s*(?:sub|function|if|try)\b/i.test(lower) || /^end(?:sub|function|if|try)\b/i.test(lower)) {
      popUntil(stack, 'other');
    }

    const flowMatch = /^(continue|exit)\s+(for|while)\b/i.exec(lower);
    if (flowMatch) {
      const keyword = flowMatch[1].toLowerCase();
      const loopType = flowMatch[2].toLowerCase();
      const insideCorrectLoop = stack.includes(loopType);
      if (!insideCorrectLoop) {
        const col = raw.search(/\S/);
        diagnostics.push({
          severity: config['syntax/flow-outside-loop'] ?? 'error',
          code: 'syntax/flow-outside-loop',
          message: `\`${keyword} ${loopType}\` is only valid inside a \`${loopType}\` loop body.`,
          line: i,
          column: col,
          endLine: i,
          endColumn: col + trimmed.length,
          filePath,
        });
      }
    }
  }

  return diagnostics;
}
