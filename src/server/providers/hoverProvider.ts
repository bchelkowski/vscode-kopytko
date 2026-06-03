import { Hover, MarkupKind, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findBuiltin } from '../brightscript/builtins';
import {
  findComponent,
  getComponentMethods,
  findMethodInterface,
  CATALOG_LAST_VERIFIED,
} from '../brightscript/components';
import { findExport } from '../kopytko/modules';
import { inferTypes, resolveReceiverType } from '../brightscript/typeInference';

/**
 * Provides hover documentation for:
 *   - BrightScript component names  (roArray, roUrlTransfer, …)
 *   - BrightScript component methods (Push, GetToString, …) — type-inferred from CreateObject
 *   - BrightScript built-in functions (Abs, Len, …)
 *   - Kopytko module exports (setState, navigate, …)
 */
export class BrightScriptHoverProvider {
  async provideHover(document: TextDocument, position: Position): Promise<Hover | null> {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const line = lines[position.line];
    if (!line) return null;

    const word = getWordAtPosition(line, position.character);
    if (!word) return null;

    // ── 1. Component name hover (e.g. user hovers over "roUrlTransfer") ──────
    const component = findComponent(word);
    if (component) {
      const ifaceList = component.interfaces.join(', ');
      const methodCount = getComponentMethods(word).length;
      return markdown([
        `**${component.name}** *(BrightScript component)*`,
        '',
        component.description,
        '',
        `*Interfaces:* \`${ifaceList}\`  ·  *${methodCount} methods*`,
        '',
        `[Roku docs](${component.docsUrl})`,
        '',
        `*Catalog verified: ${CATALOG_LAST_VERIFIED}*`,
      ]);
    }

    // ── 2. Component member hover — infer receiver type from context ──────────
    const typeMap = inferTypes(text);
    const memberHover = tryMemberHover(line, position.character, word, typeMap);
    if (memberHover) return memberHover;

    // ── 3. BrightScript built-in function ─────────────────────────────────────
    const builtin = findBuiltin(word);
    if (builtin) {
      return markdown([
        `**${builtin.name}** *(BrightScript built-in · ${builtin.category})*`,
        '',
        `\`\`\`brightscript\n${builtin.signature}\n\`\`\``,
        '',
        builtin.description,
      ]);
    }

    // ── 4. Kopytko module export ───────────────────────────────────────────────
    const kopytkoExport = findExport(word);
    if (kopytkoExport) {
      const { module: mod, export: exp } = kopytkoExport;
      return markdown([
        `**${exp.name}** *(${mod.name} — \`${mod.npmPackage}\`)*`,
        '',
        exp.signature ? `\`\`\`brightscript\n${exp.signature}\n\`\`\`` : '',
        '',
        exp.description,
      ]);
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function markdown(lines: string[]): Hover {
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: lines.filter((l) => l !== undefined).join('\n'),
    },
  };
}

/**
 * Attempts to show method documentation when the cursor is on a method name
 * that follows a dot whose receiver has a known type.
 *
 * Strategy: scan left from the current word to find `receiverName.methodName`.
 */
function tryMemberHover(
  line: string,
  charPos: number,
  word: string,
  typeMap: Map<string, string>
): Hover | null {
  // Find the word span first
  const wordStart = findWordStart(line, charPos);
  if (wordStart <= 0) return null;

  // Check that the character immediately before the word is a dot
  if (line[wordStart - 1] !== '.') return null;

  // Extract the receiver identifier before the dot
  const beforeDot = line.substring(0, wordStart - 1);
  const receiverMatch = /(\w+)$/.exec(beforeDot);
  if (!receiverMatch) return null;

  const receiverName = receiverMatch[1];
  const componentType = resolveReceiverType(receiverName, typeMap);
  if (!componentType) return null;

  // Find the method on that component
  const methods = getComponentMethods(componentType);
  const method = methods.find((m) => m.name.toLowerCase() === word.toLowerCase());
  if (!method) return null;

  const iface = findMethodInterface(componentType, method.name);
  const deprecationNote = method.deprecated
    ? `\n\n> ⚠️ **Deprecated.** ${method.deprecationNote ?? ''}`
    : '';
  const sinceNote = method.since
    ? `\n\n*Available since firmware ${method.since}*`
    : '';

  return markdown([
    `**${method.name}** — \`${componentType}\`${iface ? ` *(${iface.name})*` : ''}`,
    '',
    `\`\`\`brightscript\n${method.signature}\n\`\`\``,
    '',
    method.description,
    sinceNote,
    deprecationNote,
    iface ? `\n[Roku docs — ${iface.name}](${iface.docsUrl})` : '',
  ]);
}

function getWordAtPosition(line: string, charPos: number): string | null {
  const pattern = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line)) !== null) {
    if (charPos >= m.index && charPos <= m.index + m[0].length) {
      return m[0];
    }
  }
  return null;
}

function findWordStart(line: string, charPos: number): number {
  const pattern = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line)) !== null) {
    if (charPos >= m.index && charPos <= m.index + m[0].length) {
      return m.index;
    }
  }
  return -1;
}
