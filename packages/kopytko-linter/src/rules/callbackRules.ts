import type { LintDiagnostic, RuleContext } from '../types';

/**
 * Regex matching .observeField( or .observeFieldScoped( calls.
 * Does NOT match .unobserveField or .unobserveFieldScoped.
 * Captures everything after the opening parenthesis.
 */
const OBSERVE_FIELD_RE = /\.observe(?:Field|FieldScoped)\s*\(/gi;

/**
 * Regex to extract the second string argument from an observeField call.
 * Expects: "fieldName", "callbackName"  or  "fieldName" , "callbackName"
 * Captures the callback function name (without quotes).
 */
const OBSERVE_ARGS_RE = /^\s*"[^"]*"\s*,\s*"([^"]*)"/;

/**
 * Regex matching `events:` or `events :` at the start of an AA key definition.
 * Used to detect the Kopytko template events block.
 */
const EVENTS_KEY_RE = /^\s*events\s*:\s*\{/i;

/**
 * Regex matching a key-value pair inside the events block where the value is a string literal.
 * Captures the callback function name (without quotes).
 */
const EVENT_ENTRY_RE = /^\s*(\w+)\s*:\s*"([^"]*)"/;

const FUNC_DEF_RE = /^\s*(?:function|sub)\s+(\w+)\s*\(/i;

function collectLocalFuncNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const match = FUNC_DEF_RE.exec(line);
    if (match) names.add(match[1].toLowerCase());
  }
  return names;
}

function isKnownCallback(name: string, knownFuncNames: Set<string>, localFuncNames: Set<string>): boolean {
  const lower = name.toLowerCase();
  return knownFuncNames.has(lower) || localFuncNames.has(lower);
}

/**
 * Validates that the second argument of observeField/observeFieldScoped calls
 * references an accessible function in scope.
 */
export function checkObserverCallbacks(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config, lintContext } = ctx;
  const code = 'callback/undefined-observer-callback';
  if (config[code] === 'off') return [];

  const localFuncNames = collectLocalFuncNames(lines);
  const diagnostics: LintDiagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    // Strip trailing comment
    const commentIdx = findCommentStart(raw);
    const codePart = commentIdx >= 0 ? raw.slice(0, commentIdx) : raw;

    OBSERVE_FIELD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = OBSERVE_FIELD_RE.exec(codePart)) !== null) {
      // Skip unobserve calls — the regex only matches observeField/observeFieldScoped,
      // but let's also verify the character before the dot isn't part of "unobserve"
      const prefix = codePart.slice(0, match.index);
      if (/un$/i.test(prefix)) continue;

      const afterOpen = codePart.slice(match.index + match[0].length);
      const argsMatch = OBSERVE_ARGS_RE.exec(afterOpen);
      if (!argsMatch) continue;

      const callbackName = argsMatch[1];
      if (!callbackName) continue;

      if (!isKnownCallback(callbackName, lintContext.knownFuncNames, localFuncNames)) {
        // Find the column of the callback string literal
        const fullMatch = codePart.slice(match.index);
        const callbackQuoteIdx = fullMatch.indexOf(`"${callbackName}"`);
        const col = callbackQuoteIdx >= 0
          ? match.index + callbackQuoteIdx + 1 // +1 to point inside the quote
          : match.index;

        diagnostics.push({
          severity: config[code] ?? 'error',
          code,
          message: `Callback function '${callbackName}' is not defined in this file or any reachable @import.`,
          line: lineIdx,
          column: col,
          endLine: lineIdx,
          endColumn: col + callbackName.length,
          filePath,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Validates that event callback values in Kopytko template events blocks
 * reference accessible functions in scope.
 *
 * Detects:
 *   events: {
 *     buttonSelected: "_onButtonSelected",
 *   }
 */
export function checkEventCallbacks(ctx: RuleContext): LintDiagnostic[] {
  const { lines, filePath, config, lintContext } = ctx;
  const code = 'callback/undefined-event-callback';
  if (config[code] === 'off') return [];

  const localFuncNames = collectLocalFuncNames(lines);
  const diagnostics: LintDiagnostic[] = [];

  let inEventsBlock = false;
  let braceDepth = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    if (/^\s*'/.test(raw) || /^\s*rem\b/i.test(raw)) continue;

    const commentIdx = findCommentStart(raw);
    const codePart = commentIdx >= 0 ? raw.slice(0, commentIdx) : raw;

    if (!inEventsBlock) {
      if (EVENTS_KEY_RE.test(codePart)) {
        inEventsBlock = true;
        braceDepth = 1;

        // Check if there are entries on the same line after the opening brace
        const afterBrace = codePart.slice(codePart.indexOf('{') + 1);
        checkEventEntries(afterBrace, lineIdx, codePart.indexOf('{') + 1, diagnostics, callbackName =>
          isKnownCallback(callbackName, lintContext.knownFuncNames, localFuncNames),
        code, config, filePath);

        // Check for closing brace on same line
        for (const ch of afterBrace) {
          if (ch === '{') braceDepth++;
          else if (ch === '}') braceDepth--;
        }
        if (braceDepth <= 0) inEventsBlock = false;
      }
      continue;
    }

    // Inside events block — track braces and check entries
    checkEventEntries(codePart, lineIdx, 0, diagnostics, callbackName =>
      isKnownCallback(callbackName, lintContext.knownFuncNames, localFuncNames),
    code, config, filePath);

    for (const ch of codePart) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }
    if (braceDepth <= 0) inEventsBlock = false;
  }

  return diagnostics;
}

function checkEventEntries(
  codePart: string,
  lineIdx: number,
  colOffset: number,
  diagnostics: LintDiagnostic[],
  isKnown: (name: string) => boolean,
  code: string,
  config: Record<string, string>,
  filePath: string,
): void {
  const match = EVENT_ENTRY_RE.exec(codePart);
  if (!match) return;

  const callbackName = match[2];
  if (!callbackName) return;

  if (!isKnown(callbackName)) {
    const callbackQuoteIdx = codePart.indexOf(`"${callbackName}"`);
    const col = callbackQuoteIdx >= 0 ? colOffset + callbackQuoteIdx + 1 : colOffset;

    diagnostics.push({
      severity: (config[code] ?? 'error') as 'error' | 'warning' | 'info' | 'hint',
      code,
      message: `Event callback function '${callbackName}' is not defined in this file or any reachable @import.`,
      line: lineIdx,
      column: col,
      endLine: lineIdx,
      endColumn: col + callbackName.length,
      filePath,
    });
  }
}

/**
 * Find the start index of a trailing comment (single quote outside a string).
 * Returns -1 if no comment is found.
 */
function findCommentStart(line: string): number {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inString && line[i + 1] === '"') {
        i++; // skip escaped quote
      } else {
        inString = !inString;
      }
    } else if (!inString && ch === "'") {
      return i;
    }
  }
  return -1;
}
