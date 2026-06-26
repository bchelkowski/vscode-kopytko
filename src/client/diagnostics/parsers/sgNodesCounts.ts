import { stripConsoleResponse } from './consoleResponse';

/** A single SceneGraph node type with its live instance count and static size. */
export interface NodeTypeCount {
  /** Node subtype name — includes custom project components (e.g. `EventTileModel`). */
  type: string;
  /** Number of live instances of this type. */
  count: number;
  /** Static memory attributed to this type, bytes. */
  staticBytes: number;
}

/** Aggregated node-count snapshot, parsed from `sgnodes counts` (port 8080). */
export interface SgNodesCounts {
  /** Total number of live SceneGraph nodes. */
  totalCount: number;
  /** Total static memory across all nodes, bytes. */
  totalStaticBytes: number;
  /** Per-type breakdown, in device order. */
  types: NodeTypeCount[];
}

const TOTAL_COUNT_RE = /<nodes-count>(\d+)<\/nodes-count>/i;
const TOTAL_BYTES_RE = /<nodes-num-bytes-static>(\d+)<\/nodes-num-bytes-static>/i;
const NODE_RE = /<node>([\s\S]*?)<\/node>/gi;
const TYPE_RE = /<type>([^<]*)<\/type>/i;
const COUNT_RE = /<count>(\d+)<\/count>/i;
const BYTES_RE = /<num-bytes-static>(\d+)<\/num-bytes-static>/i;

/**
 * Parses a raw `sgnodes counts` response into a {@link SgNodesCounts}.
 *
 * The response is XML:
 * ```xml
 * <sg-nodes>
 *   <nodes-count>311</nodes-count>
 *   <nodes-num-bytes-static>179272</nodes-num-bytes-static>
 *   <nodes>
 *     <node><type>EventTileModel</type><count>54</count><num-bytes-static>15120</num-bytes-static></node>
 *     …
 *   </nodes>
 * </sg-nodes>
 * ```
 *
 * Uses tolerant regex extraction (no XML dependency), matching the existing
 * `EcpClient` parsing style. Returns `null` when the response is not a node-count
 * document (e.g. a `Usage:` hint).
 */
export function parseSgNodesCounts(raw: string): SgNodesCounts | null {
  const text = stripConsoleResponse(raw);
  if (!/<sg-nodes>/i.test(text)) return null;

  const totalCount = Number(TOTAL_COUNT_RE.exec(text)?.[1] ?? NaN);
  const totalStaticBytes = Number(TOTAL_BYTES_RE.exec(text)?.[1] ?? 0);

  const types: NodeTypeCount[] = [];
  let m: RegExpExecArray | null;
  NODE_RE.lastIndex = 0;
  while ((m = NODE_RE.exec(text)) !== null) {
    const body = m[1];
    const type = TYPE_RE.exec(body)?.[1]?.trim();
    if (!type) continue;
    types.push({
      type,
      count: Number(COUNT_RE.exec(body)?.[1] ?? 0),
      staticBytes: Number(BYTES_RE.exec(body)?.[1] ?? 0),
    });
  }

  if (Number.isNaN(totalCount) && types.length === 0) return null;

  return {
    totalCount: Number.isNaN(totalCount)
      ? types.reduce((sum, t) => sum + t.count, 0)
      : totalCount,
    totalStaticBytes,
    types,
  };
}
