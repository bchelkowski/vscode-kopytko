import { CompletionItem, CompletionItemKind, MarkupKind } from 'vscode-languageserver/node';
import {
  EXPECT_MATCHERS,
  MOCK_FUNCTION_METHODS,
  TEST_SUITE_METHODS,
  ALL_TEST_GLOBALS,
  FAKE_CLOCK_METHODS,
  TestApiEntry,
} from '../../kopytko/testFramework';
import { TestDotContext } from './completionContexts';

export function testFrameworkDotCompletions(ctx: TestDotContext): CompletionItem[] {
  let entries: TestApiEntry[];
  switch (ctx) {
    case 'expect':
    case 'expect.not':
      entries = EXPECT_MATCHERS.filter(e => e.name !== 'not');
      break;
    case 'mockFunction':
      entries = MOCK_FUNCTION_METHODS;
      break;
    case 'fakeClock':
      entries = FAKE_CLOCK_METHODS;
      break;
    case 'testSuite':
      entries = TEST_SUITE_METHODS;
      break;
    default:
      return [];
  }

  return entries.map((entry) => ({
    label: entry.name,
    kind: CompletionItemKind.Method,
    detail: entry.signature,
    sortText: `0_${entry.name}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${entry.name}**\n\n\`\`\`brightscript\n${entry.signature}\n\`\`\`\n\n${entry.description}`,
    },
  }));
}

export function testGlobalCompletions(): CompletionItem[] {
  return ALL_TEST_GLOBALS.map((entry) => ({
    label: entry.name,
    kind: entry.name === 'expect' || entry.name === 'mockFunction'
      ? CompletionItemKind.Function
      : CompletionItemKind.Function,
    detail: entry.signature,
    sortText: `1_${entry.name}`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${entry.name}** *(kopytko-unit-testing-framework)*\n\n${entry.description}`,
    },
  }));
}
