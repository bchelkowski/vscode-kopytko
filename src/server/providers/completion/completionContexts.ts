import { Position, Range } from 'vscode-languageserver/node';

export type TestDotContext = 'expect' | 'expect.not' | 'mockFunction' | 'fakeClock' | 'testSuite';

export interface CreateObjectStringContext {
  /** Start column of the string content (after the opening quote). */
  contentStart: number;
  /** End column of the string content (before the closing quote, or end of line). */
  contentEnd: number;
  /** Text typed so far inside the quotes. */
  prefix: string;
}

export function resolveReceiverOwnerFunction(
  receiverName: string,
  lines: string[],
  cursorLine: number,
): string | null {
  const assignRe = new RegExp(
    `^\\s*${receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(\\w+)\\s*\\(`,
    'i'
  );
  for (let i = cursorLine - 1; i >= 0; i--) {
    const m = assignRe.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

export function isDotAccessContext(line: string, charPos: number): boolean {
  let pos = charPos;
  while (pos > 0 && /\w/.test(line[pos - 1])) pos--;
  return pos > 0 && line[pos - 1] === '.';
}

export function getInlineFunctionCallName(line: string, charPos: number): string | null {
  let pos = charPos;
  while (pos > 0 && /\w/.test(line[pos - 1])) pos--;
  if (pos <= 0 || line[pos - 1] !== '.') return null;

  const beforeDot = line.substring(0, pos - 1);
  const match = /\b(\w+)\s*\([^)]*\)\s*$/.exec(beforeDot);
  if (!match) return null;

  const name = match[1];
  if (/^CreateObject$/i.test(name)) return null;
  if (/^(?:if|while|for|return|print|sub|function)$/i.test(name)) return null;

  return name;
}

export function getTestDotContext(line: string, charPos: number): TestDotContext | null {
  const before = line.substring(0, charPos);
  if (/expect\s*\([^)]*\)\s*\.\s*not\s*\.\s*$/i.test(before)) return 'expect.not';
  if (/expect\s*\([^)]*\)\s*\.\s*$/i.test(before)) return 'expect';
  if (/mockFunction\s*\([^)]*\)\s*\.\s*$/i.test(before)) return 'mockFunction';
  if (/fakeClock\s*\([^)]*\)\s*\.\s*$/i.test(before)) return 'fakeClock';
  if (/\bts\s*\(\s*\)\s*\.\s*$/i.test(before)) return 'testSuite';
  return null;
}

export function isKopytkoAnnotationContext(line: string, charPos: number): boolean {
  return /^\s*'?\s*@/.test(line.substring(0, charPos));
}

export function computeAnnotationEditRange(line: string, position: Position): Range {
  const upToCursor = line.substring(0, position.character);
  const leadingWhitespace = /^\s*/.exec(upToCursor)?.[0].length ?? 0;
  return {
    start: { line: position.line, character: leadingWhitespace },
    end: { line: position.line, character: position.character },
  };
}

export function isImportPackageContext(line: string, charPos: number): boolean {
  return /^\s*'\s*@import\s+\S+\s+from\s+/.test(line.substring(0, charPos));
}

export function isImportPathContext(line: string, charPos: number): boolean {
  return /^\s*'\s*@import\s+\/[^\s'"]*$/.test(line.substring(0, charPos));
}

export function extractImportPathPrefix(line: string, charPos: number): string {
  const match = /^\s*'\s*@import\s+(\/[^\s'"]*)$/.exec(line.substring(0, charPos));
  return match ? match[1] : '/';
}

export function isTypeAnnotationContext(line: string, charPos: number): boolean {
  return /\bas\s+\w*$/.test(line.substring(0, charPos));
}

export function getCreateObjectStringContext(
  line: string,
  charPos: number,
): CreateObjectStringContext | undefined {
  const re = /\bCreateObject\s*\(\s*"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const contentStart = m.index + m[0].length;
    const closingQuote = line.indexOf('"', contentStart);
    const contentEnd = closingQuote >= 0 ? closingQuote : line.length;

    if (charPos >= contentStart && charPos <= contentEnd) {
      return {
        contentStart,
        contentEnd,
        prefix: line.substring(contentStart, charPos),
      };
    }
  }
  return undefined;
}

export function isMtopAccess(line: string, charPos: number): boolean {
  let pos = charPos;
  while (pos > 0 && /\w/.test(line[pos - 1])) pos--;
  if (pos <= 0 || line[pos - 1] !== '.') return false;
  return /\bm\.top$/i.test(line.substring(0, pos - 1));
}
