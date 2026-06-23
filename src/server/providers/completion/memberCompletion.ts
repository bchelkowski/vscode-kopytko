import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver/node';
import {
  CasingConfig,
  DEFAULT_CASING_CONFIG,
  applyCasingWithOverrides,
  findComponent,
  getComponentMethods,
  findMethodInterface,
} from 'kopytko-brightscript-parser';
import { KopytkoImportResolver } from '../../kopytko/importResolver';
import { InnerMethodDefinition } from '../../brightscript/functionIndex';
import { collectMtopItems, MtopField, MtopMethod } from '../../brightscript/mtopResolver';
import { applySnippetCasing } from '../../brightscript/casingUtils';
import { buildMethodCompletionItem, buildMethodSnippet } from './completionBuilders';

export function memberCompletions(componentType: string, casing: CasingConfig = DEFAULT_CASING_CONFIG): CompletionItem[] {
  const component = findComponent(componentType);
  if (!component) return [];

  const methods = getComponentMethods(componentType);
  return methods
    .filter((m) => !m.deprecated)
    .map((method) => {
      const iface = findMethodInterface(componentType, method.name);
      const detail = iface
        ? `${method.returnType} — ${iface.name}`
        : method.returnType;

      return buildMethodCompletionItem(method, detail, component.name, iface?.name, casing);
    });
}

export function mtopCompletions(
  documentPath: string,
  importResolver: KopytkoImportResolver,
  casing: CasingConfig = DEFAULT_CASING_CONFIG,
): CompletionItem[] {
  const { fields, methods } = collectMtopItems(documentPath, importResolver);
  const items: CompletionItem[] = [];

  for (const f of fields) {
    items.push(buildMtopFieldItem(f));
  }
  for (const m of methods) {
    items.push(buildMtopMethodItem(m, casing));
  }
  return items;
}

export function innerMethodCompletions(
  ownerFunc: string | null,
  allMethods: InnerMethodDefinition[],
): CompletionItem[] {
  if (!ownerFunc) return [];
  const ownerLower = ownerFunc.toLowerCase();
  const seen = new Set<string>();
  const items: CompletionItem[] = [];
  for (const method of allMethods) {
    if (method.ownerFunction?.toLowerCase() !== ownerLower) continue;
    if (seen.has(method.nameLower)) continue;
    seen.add(method.nameLower);
    items.push({
      label: method.name,
      kind: CompletionItemKind.Method,
      sortText: `0_${method.name}`,
    });
  }
  return items;
}

function buildMtopFieldItem(f: MtopField): CompletionItem {
  const detail = f.readonly ? `${f.type} (read-only)` : f.type;
  return {
    label: f.name,
    kind: f.type === 'function' ? CompletionItemKind.Function : CompletionItemKind.Field,
    detail,
    insertText: f.name,
    sortText: `0_${f.name}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${f.name}** — \`${f.type}\`\n\n${f.description}`,
    },
  };
}

function buildMtopMethodItem(m: MtopMethod, casing: CasingConfig): CompletionItem {
  const label = applyCasingWithOverrides(m.name, casing.method, casing.exact);
  const snippet = applySnippetCasing(buildMethodSnippet(m.signature), casing.method);
  const ifaceLine = m.interface ? `*Interface: ${m.interface}*\n\n` : '';
  return {
    label,
    kind: CompletionItemKind.Method,
    detail: m.returnType,
    insertText: snippet,
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: `1_${m.name}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${m.name}**\n\n${ifaceLine}\`\`\`brightscript\n${m.signature}\n\`\`\`\n\n${m.description}`,
    },
  };
}
