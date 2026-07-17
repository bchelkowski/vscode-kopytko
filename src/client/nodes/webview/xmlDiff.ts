/**
 * Field-level diff between two SceneGraph app-ui XML trees, for Edit mode.
 *
 * Compares a baseline tree against a user-edited tree and produces a list of
 * field edits translatable to RALE TrackerTask `setField` commands. Structural
 * changes (added/removed/renamed/reordered elements) are rejected — v1 edits
 * field values only. Attribute additions are allowed (TrackerTask's setField
 * creates missing fields); attribute removals are not (that would be
 * removeField, out of scope).
 *
 * Kept free of DOM lib types so the algorithm is unit-testable under Node —
 * the webview adapts real Elements via domToLite().
 */

/** Structural mirror of an XML element. */
export interface LiteEl {
  tag: string;
  attrs: Record<string, string>;
  children: LiteEl[];
}

/**
 * One step of an edit's location, from the app-ui tree. The app-ui XML shows
 * only *renderable* children while the device's real child indices count
 * every node (Tasks, Timers, ContentNodes, …), so app-ui child indices cannot
 * address a device node directly. Instead each step carries what IS stable
 * across the two views: the subtype, the node id (app-ui `name`) when
 * present, and the ordinal among same-subtype siblings — app-ui children are
 * an order-preserving subsequence of the device children, so the n-th
 * <Label> in app-ui is the n-th Label child on the device.
 */
export interface PathStep {
  subtype: string;
  id?: string;
  /** 0-based position among siblings with the same subtype (in app-ui). */
  ordinal: number;
}

/** One field change, addressed by a step chain from the diff root. */
export interface FieldEdit {
  /** Child-index chain from the diff root (the app-ui `<screen>` element) —
   *  display/reporting only; device resolution uses `steps`. */
  path: number[];
  /** Steps from the `<screen>` element down to the target node. `steps[0]`
   *  is the scene itself. */
  steps: PathStep[];
  /** Node subtype (XML tag name) — used to verify the target before writing. */
  subtype: string;
  /** Node id (app-ui `name` attribute) when present — extra verification. */
  id?: string;
  field: string;
  /** Raw attribute text as edited. */
  value: string;
  /** JSON-native value to send over the wire (typed from the baseline value). */
  wireValue: unknown;
}

export type DiffResult =
  | { ok: true; edits: FieldEdit[] }
  | { ok: false; error: string };

/**
 * Attributes synthesized by the ECP app-ui/sgnodes dumps or read-only in
 * practice — never diffable, and editing one is an error.
 */
const SYNTHETIC_ATTRS = new Set([
  '_sn', 'osref', 'bscref', '_psn',
  'extends', 'index', 'children', 'bounds', 'sceneRect', 'focused',
]);

/** Minimal Element surface domToLite needs (structural, no DOM lib import). */
interface DomElementLike {
  tagName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  children: ArrayLike<DomElementLike>;
}

export function domToLite(el: DomElementLike): LiteEl {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    attrs[a.name] = a.value;
  }
  const children: LiteEl[] = [];
  for (let i = 0; i < el.children.length; i++) {
    children.push(domToLite(el.children[i]));
  }
  return { tag: el.tagName, attrs, children };
}

/**
 * Diff `edited` against `base`. Both roots are the same container element
 * (e.g. app-ui `<screen>`); the container itself is not diffed for attributes.
 */
export function diffTrees(base: LiteEl, edited: LiteEl): DiffResult {
  const edits: FieldEdit[] = [];
  const error = walk(base, edited, [], [], edits, true);
  if (error) return { ok: false, error };
  return { ok: true, edits };
}

function walk(
  base: LiteEl,
  edited: LiteEl,
  path: number[],
  steps: PathStep[],
  edits: FieldEdit[],
  isRoot: boolean,
): string | null {
  if (base.tag !== edited.tag) {
    return `structural change not supported: ${describe(base, path)} was renamed to <${edited.tag}>`;
  }
  if (!isRoot) {
    const attrError = diffAttrs(base, edited, path, steps, edits);
    if (attrError) return attrError;
  }
  if (base.children.length !== edited.children.length) {
    const delta = edited.children.length - base.children.length;
    const what = delta > 0 ? `${delta} element(s) added` : `${-delta} element(s) removed`;
    return `structural change not supported: ${what} under ${describe(base, path)}`;
  }
  const tagCounts = new Map<string, number>();
  for (let i = 0; i < base.children.length; i++) {
    const child = base.children[i];
    const ordinal = tagCounts.get(child.tag) ?? 0;
    tagCounts.set(child.tag, ordinal + 1);
    const step: PathStep = { subtype: child.tag, id: child.attrs['name'], ordinal };
    const error = walk(child, edited.children[i], [...path, i], [...steps, step], edits, false);
    if (error) return error;
  }
  return null;
}

function diffAttrs(
  base: LiteEl,
  edited: LiteEl,
  path: number[],
  steps: PathStep[],
  edits: FieldEdit[],
): string | null {
  for (const key of Object.keys(base.attrs)) {
    if (!(key in edited.attrs)) {
      return `removing attribute "${key}" from ${describe(base, path)} is not supported — `
        + 'only field value changes and additions can be applied';
    }
  }
  for (const [key, value] of Object.entries(edited.attrs)) {
    const baseValue = base.attrs[key] as string | undefined;
    if (value === baseValue) continue;
    if (SYNTHETIC_ATTRS.has(key)) {
      return `"${key}" on ${describe(base, path)} is a read-only attribute and cannot be edited`;
    }
    edits.push({
      path: [...path],
      steps: [...steps],
      subtype: base.tag,
      id: base.attrs['name'],
      field: key,
      value,
      wireValue: coerceFieldValue(value, baseValue),
    });
  }
  return null;
}

/**
 * Convert an edited attribute string to the JSON-native value sent to
 * TrackerTask. The type is inferred from the *baseline* value so an edit
 * can't silently change a field's type (e.g. a string field whose new value
 * happens to look numeric stays a string). Added attributes (no baseline)
 * infer from the new value itself.
 */
export function coerceFieldValue(raw: string, baseRaw?: string): unknown {
  const reference = baseRaw ?? raw;

  if (isBooleanText(reference)) {
    return isBooleanText(raw) ? raw.trim().toLowerCase() === 'true' : raw;
  }
  if (isNumericText(reference)) {
    return isNumericText(raw) ? Number(raw) : raw;
  }
  // Vector-ish fields (translation, size, …): app-ui prints them as
  // `{333, 222}` while XML markup uses `[333,222]`. SceneGraph silently
  // ignores the curly form when set as a string (verified on device), so
  // both forms must be sent as a real number array.
  if (isJsonArrayText(reference) || isCurlyVectorText(reference)) {
    const parsed = parseNumberList(raw);
    return parsed ?? raw;
  }
  return raw;
}

function isBooleanText(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === 'true' || t === 'false';
}

function isNumericText(s: string): boolean {
  const t = s.trim();
  return t !== '' && /^-?(\d+\.?\d*|\.\d+)$/.test(t);
}

function isJsonArrayText(s: string): boolean {
  return s.trim().startsWith('[');
}

/** app-ui's vector/rect print format: `{0, 0}`, `{0, 0, 1920, 1080}`. */
function isCurlyVectorText(s: string): boolean {
  return /^\{\s*-?\d*\.?\d+(\s*,\s*-?\d*\.?\d+)*\s*\}$/.test(s.trim());
}

/** Parse `[…]` (any JSON array) or `{1, 2}` (curly number vector) into an
 *  array; null when the text is neither. */
function parseNumberList(s: string): unknown[] | null {
  const t = s.trim();
  if (isCurlyVectorText(t)) {
    return t.slice(1, -1).split(',').map(part => Number(part.trim()));
  }
  if (isJsonArrayText(t)) {
    try {
      const parsed: unknown = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  return null;
}

function describe(el: LiteEl, path: number[]): string {
  const name = el.attrs['name'] ? ` "${el.attrs['name']}"` : '';
  return `<${el.tag}>${name} (path ${path.join('/') || 'root'})`;
}
