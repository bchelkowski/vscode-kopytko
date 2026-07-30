/**
 * Sorts SceneGraph `<interface>` `<field>`/`<function>` entries.
 *
 * Unlike `formatText()`, this does not run a multi-pass pipeline — the only thing this formatter
 * currently does to XML is reorder `<interface>` children, so a single tokenize → reorder → splice
 * step is sufficient. All the structural parsing (finding the `<interface>` block, tokenizing its
 * `<field>`/`<function>` children into reorderable, comment-attached chunks) lives in
 * `kopytko-brightscript-parser`'s `tokenizeXmlInterfaceElements` — this module only decides *how*
 * to reorder what the parser already tokenized.
 */

import { tokenizeXmlInterfaceElements } from 'kopytko-brightscript-parser';
import type { XmlInterfaceChunk } from 'kopytko-brightscript-parser';
import { FormattingConfig, getEffectiveSortPriorityKeys } from './config';

export function formatXml(source: string, config: FormattingConfig): string {
  if (config.xmlInterfaceSortOrder === 'preserve' && config.xmlInterfaceGroupOrder === 'preserve') {
    return source;
  }

  const tokenized = tokenizeXmlInterfaceElements(source);
  if (!tokenized) return source; // malformed/unexpected content — leave the file untouched

  const { innerStart, innerEnd, items, trailingText } = tokenized;
  if (items.length < 2) return source; // nothing to reorder

  // Round-trip guard: defense in depth on top of the parser's own tokenization contract, since
  // there's no independent XML re-parse here to verify against (this formatter's equivalent of
  // `verifySyntax` for .brs formatting).
  const originalInner = source.slice(innerStart, innerEnd);
  if (items.map((i) => i.chunk).join('') + trailingText !== originalInner) return source;

  const priorityLower = getEffectiveSortPriorityKeys(config, config.xmlInterfaceSortPriorityKeys).map((k) => k.toLowerCase());
  const reordered = computeOrder(items, config.xmlInterfaceGroupOrder, config.xmlInterfaceSortOrder === 'alphabetical', priorityLower);

  const newInner = reordered.map((i) => i.chunk).join('') + trailingText;
  if (newInner === originalInner) return source;

  return source.slice(0, innerStart) + newInner + source.slice(innerEnd);
}

export function checkXml(source: string, config: FormattingConfig): boolean {
  return formatXml(source, config) === source;
}

function computeOrder(
  items: XmlInterfaceChunk[],
  groupOrder: FormattingConfig['xmlInterfaceGroupOrder'],
  sortAlphabetically: boolean,
  priorityLower: string[],
): XmlInterfaceChunk[] {
  if (groupOrder === 'preserve') {
    return sortAlphabetically ? sortByKey(items, priorityLower) : items;
  }

  const fields = items.filter((i) => i.element.kind === 'field');
  const functions = items.filter((i) => i.element.kind === 'function');
  const sortedFields = sortAlphabetically ? sortByKey(fields, priorityLower) : fields;
  const sortedFunctions = sortAlphabetically ? sortByKey(functions, priorityLower) : functions;

  return groupOrder === 'fields-first' ? [...sortedFields, ...sortedFunctions] : [...sortedFunctions, ...sortedFields];
}

function sortByKey(items: XmlInterfaceChunk[], priorityLower: string[]): XmlInterfaceChunk[] {
  return [...items].sort((a, b) => compareKeys(a.element.key.toLowerCase(), b.element.key.toLowerCase(), priorityLower));
}

function compareKeys(a: string, b: string, priorityLower: string[]): number {
  const ia = priorityLower.indexOf(a);
  const ib = priorityLower.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
    const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
    if (ra !== rb) return ra - rb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
