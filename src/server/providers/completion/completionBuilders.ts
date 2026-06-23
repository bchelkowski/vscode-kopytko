import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  Range,
  TextEdit,
} from 'vscode-languageserver/node';
import {
  BRIGHTSCRIPT_BUILTINS,
  BRIGHTSCRIPT_KEYWORDS,
  BRIGHTSCRIPT_COMPONENTS,
  CasingConfig,
  DEFAULT_CASING_CONFIG,
  applyCasing,
  applyCasingWithOverrides,
} from 'kopytko-brightscript-parser';
import { applySnippetCasing } from '../../brightscript/casingUtils';
import { CreateObjectStringContext } from './completionContexts';

const ACTIVE_COMPONENTS = BRIGHTSCRIPT_COMPONENTS.filter((c) => !c.deprecated);
const PRIMITIVE_TYPES = [
  'Boolean', 'Double', 'Dynamic', 'Float', 'Function',
  'Integer', 'Interface', 'LongInteger', 'Object', 'String', 'Void',
];

export function typeAnnotationCompletions(casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
  const primitives: CompletionItem[] = PRIMITIVE_TYPES.map((t) => {
    const label = applyCasing(t, casing.keyword);
    return {
      label,
      kind: CompletionItemKind.TypeParameter,
      insertText: label,
      sortText: `0_${t}`,
      detail: 'BrightScript type',
    };
  });

  const components: CompletionItem[] = ACTIVE_COMPONENTS.map((c) => ({
    label: c.name,
    kind: CompletionItemKind.Class,
    detail: c.description,
    insertText: c.name,
    sortText: `1_${c.name}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: buildComponentDoc(c),
    },
  }));

  return [...primitives, ...components];
}

export function createObjectStringCompletions(
  ctx: CreateObjectStringContext,
  lineIdx: number,
): CompletionItem[] {
  const editRange = Range.create(
    { line: lineIdx, character: ctx.contentStart },
    { line: lineIdx, character: ctx.contentEnd },
  );
  return ACTIVE_COMPONENTS.map((c) => ({
    label: c.name,
    kind: CompletionItemKind.Class,
    detail: c.description,
    filterText: c.name,
    textEdit: TextEdit.replace(editRange, c.name),
    documentation: {
      kind: MarkupKind.Markdown,
      value: buildComponentDoc(c),
    },
    sortText: `0_${c.name}`,
  }));
}

export function builtinCompletions(casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
  return BRIGHTSCRIPT_BUILTINS.map((b) => {
    const label = applyCasingWithOverrides(b.name, casing.builtin, casing.exact);
    return {
      label,
      kind: CompletionItemKind.Function,
      detail: b.signature,
      insertText: label,
      sortText: `2_${b.name}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `**${b.name}** *(${b.category})*\n\n${b.description}`,
      },
    };
  });
}

export function keywordCompletions(casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
  return BRIGHTSCRIPT_KEYWORDS.map((kw) => {
    const label = applyCasingWithOverrides(kw, casing.keyword, casing.exact);
    return {
      label,
      kind: CompletionItemKind.Keyword,
      insertText: label,
      sortText: `3_${kw}`,
    };
  });
}

export function buildMethodSnippet(signature: string): string {
  const match = /^(\w+)\(([^)]*)\)/.exec(signature);
  if (!match) return signature;

  const name = match[1];
  const paramStr = match[2].trim();

  if (paramStr === '') {
    return `${name}()`;
  }

  const params = paramStr.split(',').map((p, i) => `\${${i + 1}:${p.trim()}}`);
  return `${name}(${params.join(', ')})`;
}

export function buildMethodDoc(
  method: { name: string; signature: string; description: string; since?: string; deprecated?: boolean; deprecationNote?: string },
  ifaceName: string | undefined,
  componentName: string
): string {
  const lines: string[] = [];

  lines.push(`**${method.name}** — \`${componentName}\``);
  if (ifaceName) lines.push(`*Interface: ${ifaceName}*`);
  lines.push('');
  lines.push(`\`\`\`brightscript\n${method.signature}\n\`\`\``);
  lines.push('');
  lines.push(method.description);

  if (method.since) {
    lines.push('');
    lines.push(`*Available since firmware ${method.since}*`);
  }
  if (method.deprecated) {
    lines.push('');
    lines.push(`> ⚠️ **Deprecated.** ${method.deprecationNote ?? ''}`);
  }

  return lines.join('\n');
}

export function buildComponentDoc(c: { name: string; description: string; interfaces: string[]; docsUrl: string }): string {
  return [
    `**${c.name}**`,
    '',
    c.description,
    '',
    `*Interfaces:* ${c.interfaces.join(', ')}`,
    '',
    `[Roku docs](${c.docsUrl})`,
  ].join('\n');
}

export function buildMethodCompletionItem(
  method: { name: string; signature: string; description: string; returnType: string; since?: string; deprecated?: boolean; deprecationNote?: string },
  detail: string,
  componentName: string,
  ifaceName: string | undefined,
  casing: CasingConfig,
): CompletionItem {
  const label = applyCasingWithOverrides(method.name, casing.method, casing.exact);
  const snippet = applySnippetCasing(buildMethodSnippet(method.signature), casing.method);

  return {
    label,
    kind: CompletionItemKind.Method,
    detail,
    insertText: snippet,
    insertTextFormat: InsertTextFormat.Snippet,
    documentation: {
      kind: MarkupKind.Markdown,
      value: buildMethodDoc(method, ifaceName, componentName),
    },
    sortText: `0_${method.name}`,
  };
}
