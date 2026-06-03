import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  Position,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BRIGHTSCRIPT_BUILTINS, BRIGHTSCRIPT_KEYWORDS } from '../brightscript/builtins';
import {
  BRIGHTSCRIPT_COMPONENTS,
  findComponent,
  getComponentMethods,
  findMethodInterface,
} from '../brightscript/components';
import { KOPYTKO_MODULES } from '../kopytko/modules';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import { inferTypes, getReceiverName, resolveReceiverType } from '../brightscript/typeInference';

/**
 * Provides completion items for BrightScript + Kopytko files.
 *
 * Completion contexts (evaluated in priority order):
 *  1. `' @…`              → Kopytko annotation snippets
 *  2. `' @import … from ` → Kopytko module package names
 *  3. `identifier.`       → Component member completions (via CreateObject type inference)
 *  4. Default             → Built-in functions + language keywords + CreateObject component names
 */
export class BrightScriptCompletionProvider {
  constructor(private readonly _importResolver: KopytkoImportResolver) {}

  async provideCompletions(
    document: TextDocument,
    position: Position
  ): Promise<CompletionItem[]> {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const currentLine = lines[position.line] ?? '';

    // 1. @import … from <package> context (must be checked before the annotation context)
    if (isImportPackageContext(currentLine, position.character)) {
      return this.importModuleCompletions();
    }

    // 2. Kopytko annotation context: `' @`
    if (isKopytkoAnnotationContext(currentLine, position.character)) {
      return this.kopytkoAnnotationCompletions();
    }

    // 3. Member access: `someVar.`
    const receiverName = getReceiverName(currentLine, position.character);
    if (receiverName !== null) {
      const typeMap = inferTypes(text);
      const componentType = resolveReceiverType(receiverName, typeMap);
      if (componentType) {
        return this.memberCompletions(componentType);
      }
      // Receiver found but type unknown — return empty so VS Code falls back to
      // its word-based completions rather than flooding with irrelevant items.
      return [];
    }

    // 4. Default completions
    return [
      ...this.createObjectCompletions(),
      ...this.builtinCompletions(),
      ...this.keywordCompletions(),
    ];
  }

  // ---------------------------------------------------------------------------
  // Member completions
  // ---------------------------------------------------------------------------

  /**
   * Returns one CompletionItem per method on componentType, grouped by interface.
   */
  memberCompletions(componentType: string): CompletionItem[] {
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

        return {
          label: method.name,
          kind: CompletionItemKind.Method,
          detail,
          insertText: buildMethodSnippet(method.signature),
          insertTextFormat: InsertTextFormat.Snippet,
          documentation: {
            kind: MarkupKind.Markdown,
            value: buildMethodDoc(method, iface?.name, component.name),
          },
          sortText: `0_${method.name}`, // sort methods above generic items
        };
      });
  }

  // ---------------------------------------------------------------------------
  // CreateObject completions (suggest component names)
  // ---------------------------------------------------------------------------

  private createObjectCompletions(): CompletionItem[] {
    return BRIGHTSCRIPT_COMPONENTS.filter((c) => !c.deprecated).map((c) => ({
      label: c.name,
      kind: CompletionItemKind.Class,
      detail: `CreateObject("${c.name}")`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildComponentDoc(c),
      },
      sortText: `1_${c.name}`,
    }));
  }

  // ---------------------------------------------------------------------------
  // Kopytko / import completions
  // ---------------------------------------------------------------------------

  private kopytkoAnnotationCompletions(): CompletionItem[] {
    return [
      {
        label: '@import',
        kind: CompletionItemKind.Keyword,
        insertText: "@import /${1:path/to/file.brs}",
        insertTextFormat: InsertTextFormat.Snippet,
        detail: 'Kopytko internal import',
        documentation: {
          kind: MarkupKind.Markdown,
          value: "Import an internal BrightScript file.\n\n```brightscript\n' @import /components/MyComponent.brs\n```",
        },
      },
      {
        label: '@import … from',
        kind: CompletionItemKind.Keyword,
        insertText: "@import /${1:path/to/file.brs} from ${2:@kopytko/package}",
        insertTextFormat: InsertTextFormat.Snippet,
        detail: 'Kopytko external import',
        documentation: {
          kind: MarkupKind.Markdown,
          value: "Import from an installed Kopytko NPM module.\n\n```brightscript\n' @import /components/KopytkoFramework.brs from @dazn/kopytko-framework\n```",
        },
      },
    ];
  }

  private importModuleCompletions(): CompletionItem[] {
    return KOPYTKO_MODULES.map((mod) => ({
      label: mod.npmPackage,
      kind: CompletionItemKind.Module,
      detail: mod.name,
      documentation: { kind: MarkupKind.Markdown, value: mod.description },
    }));
  }

  // ---------------------------------------------------------------------------
  // Global completions
  // ---------------------------------------------------------------------------

  private builtinCompletions(): CompletionItem[] {
    return BRIGHTSCRIPT_BUILTINS.map((b) => ({
      label: b.name,
      kind: CompletionItemKind.Function,
      detail: b.signature,
      sortText: `2_${b.name}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `**${b.name}** *(${b.category})*\n\n${b.description}`,
      },
    }));
  }

  private keywordCompletions(): CompletionItem[] {
    return BRIGHTSCRIPT_KEYWORDS.map((kw) => ({
      label: kw,
      kind: CompletionItemKind.Keyword,
      sortText: `3_${kw}`,
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isKopytkoAnnotationContext(line: string, charPos: number): boolean {
  return /^\s*'\s*@/.test(line.substring(0, charPos));
}

function isImportPackageContext(line: string, charPos: number): boolean {
  return /^\s*'\s*@import\s+\S+\s+from\s+/.test(line.substring(0, charPos));
}

/**
 * Converts a method signature into a VS Code snippet string.
 * Parameters are turned into tab stops: `Push(${1:a as Dynamic})`.
 * No-arg methods get a plain `MethodName()` with the cursor inside.
 */
function buildMethodSnippet(signature: string): string {
  // Extract method name and param list from `Name(params) as ReturnType`
  const match = /^(\w+)\(([^)]*)\)/.exec(signature);
  if (!match) return signature;

  const name = match[1];
  const paramStr = match[2].trim();

  if (paramStr === '') {
    return `${name}()`;
  }

  // Build tab stops for each parameter
  const params = paramStr.split(',').map((p, i) => `\${${i + 1}:${p.trim()}}`);
  return `${name}(${params.join(', ')})`;
}

function buildMethodDoc(
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

function buildComponentDoc(c: { name: string; description: string; interfaces: string[]; docsUrl: string }): string {
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
