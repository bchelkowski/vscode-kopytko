import type { ObjectTypeEntry } from '../session/eventModel';

export interface AppObjectCounts {
  totalCount: number;
  totalPhysicalBytes: number;
  totalLogicalBytes: number;
  types: ObjectTypeEntry[];
}

/**
 * Parses the ECP `/query/app-object-counts/<appId>` response (port 8060, HTTP GET).
 *
 * Verified live response shape (Roku Ultra, firmware 15.2.4):
 * ```xml
 * <app-object-counts>
 *   <timestamp>1782995684112</timestamp>
 *   <channel-id>dev</channel-id>
 *   <objects>
 *     <objects-count>12589</objects-count>
 *     <objects-num-bytes-physical>1498532</objects-num-bytes-physical>
 *     <objects-num-bytes-logical>1413406</objects-num-bytes-logical>
 *     <objects>
 *       <object><type>roArray</type><count>1210</count>
 *         <num-bytes-physical>118644</num-bytes-physical><num-bytes-logical>84208</num-bytes-logical></object>
 *       <object><type>roSGNode</type><subtype>Font</subtype><count>157</count>
 *         <num-bytes-physical>6940</num-bytes-physical><num-bytes-logical>6940</num-bytes-logical></object>
 *     </objects>
 *   </objects>
 *   <status>OK</status>
 * </app-object-counts>
 * ```
 *
 * `<subtype>` appears only on `roSGNode` entries (one `<object>` block per
 * SceneGraph component type); all other types have exactly one block.
 */
const TOTAL_COUNT_RE = /<objects-count>(\d+)<\/objects-count>/i;
const TOTAL_PHYS_RE = /<objects-num-bytes-physical>(\d+)<\/objects-num-bytes-physical>/i;
const TOTAL_LOG_RE = /<objects-num-bytes-logical>(\d+)<\/objects-num-bytes-logical>/i;
const OBJECT_RE = /<object>([\s\S]*?)<\/object>/gi;
const TYPE_RE = /<type>([^<]*)<\/type>/i;
const SUBTYPE_RE = /<subtype>([^<]*)<\/subtype>/i;
const COUNT_RE = /<count>(\d+)<\/count>/i;
const PHYS_RE = /<num-bytes-physical>(\d+)<\/num-bytes-physical>/i;
const LOG_RE = /<num-bytes-logical>(\d+)<\/num-bytes-logical>/i;

export function parseEcpAppObjectCounts(xml: string): AppObjectCounts | null {
  if (!/<status>\s*OK\s*<\/status>/i.test(xml)) return null;

  const totalCount = Number(TOTAL_COUNT_RE.exec(xml)?.[1] ?? NaN);
  const totalPhysicalBytes = Number(TOTAL_PHYS_RE.exec(xml)?.[1] ?? 0);
  const totalLogicalBytes = Number(TOTAL_LOG_RE.exec(xml)?.[1] ?? 0);

  const types: ObjectTypeEntry[] = [];
  let m: RegExpExecArray | null;
  OBJECT_RE.lastIndex = 0;
  while ((m = OBJECT_RE.exec(xml)) !== null) {
    const body = m[1];
    const type = TYPE_RE.exec(body)?.[1]?.trim();
    if (!type) continue;
    const subtype = SUBTYPE_RE.exec(body)?.[1]?.trim();
    types.push({
      type,
      ...(subtype ? { subtype } : {}),
      count: Number(COUNT_RE.exec(body)?.[1] ?? 0),
      physicalBytes: Number(PHYS_RE.exec(body)?.[1] ?? 0),
      logicalBytes: Number(LOG_RE.exec(body)?.[1] ?? 0),
    });
  }

  if (Number.isNaN(totalCount) && types.length === 0) return null;

  return {
    totalCount: Number.isNaN(totalCount)
      ? types.reduce((sum, t) => sum + t.count, 0)
      : totalCount,
    totalPhysicalBytes,
    totalLogicalBytes,
    types,
  };
}
