import type { SgNodesCounts } from './sgNodesCounts';

/**
 * Parses the ECP `/query/sgnodes/all` response (port 8060, HTTP GET).
 *
 * The total count comes from the `node-count` attribute on `<All_Nodes>`.
 * Per-type counts are derived by counting element names inside `<All_Nodes>`:
 * each SG node renders as an XML element whose name IS its node type.
 *
 * `staticBytes` is not available from ECP (always 0).
 */
export function parseEcpSgNodes(xml: string): SgNodesCounts | null {
  if (!xml.includes('<status>OK</status>')) return null;

  const totalMatch = xml.match(/node-count="(\d+)"/);
  if (!totalMatch) return null;
  const totalCount = parseInt(totalMatch[1], 10);
  if (isNaN(totalCount)) return null;

  // Extract the All_Nodes block for type counting.
  const blockMatch = xml.match(/<All_Nodes[^>]*>([\s\S]*?)<\/All_Nodes>/);
  const block = blockMatch?.[1] ?? '';

  // Count XML element names that start with an uppercase letter — these are SG node types.
  const typeCount = new Map<string, number>();
  const tagRe = /<([A-Z][A-Za-z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(block)) !== null) {
    const type = m[1];
    typeCount.set(type, (typeCount.get(type) ?? 0) + 1);
  }

  const types = Array.from(typeCount.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => ({ type, count, staticBytes: 0 }));

  return { totalCount, totalStaticBytes: 0, types };
}
