/**
 * Resolves an app-ui edit location (a chain of PathSteps) to a device-side
 * RALE path.
 *
 * Why this exists: ECP `/query/app-ui` shows only *renderable* children,
 * while the TrackerTask's `{child: index}` segments index every child
 * (Tasks, Timers, ContentNodes, …) via `getChildren(-1, 0)`. App-ui child
 * indices therefore drift from device indices wherever non-renderable
 * children are interleaved. The app-ui children are an order-preserving
 * subsequence of the device children, so each step is matched against the
 * device's real child list (`getItemList`) by subtype — preferring a unique
 * id match, falling back to the ordinal among same-subtype siblings.
 */

import type { RaleItemList, RaleNodeItem, RalePathSegment } from 'kopytko-roku-device';
import type { PathStep } from './webview/xmlDiff';

/** Fetch the node + one level of children at a RALE path (cache upstream). */
export type ItemListFetcher = (path: RalePathSegment[]) => Promise<RaleItemList>;

export type ResolveResult =
  | { ok: true; path: RalePathSegment[] }
  | { ok: false; error: string };

/**
 * Whether an app-ui element tag can denote a device node of `deviceSubtype`.
 * app-ui does not always print the real subtype: plain `Group` nodes are
 * represented as `<RenderableNode>` (verified live — custom components and
 * other built-ins print their real names). Node ids are the reliable anchor;
 * this only gates which children are even considered.
 */
export function subtypeCompatible(appUiTag: string, deviceSubtype: string | undefined): boolean {
  if (!deviceSubtype) return false;
  if (appUiTag === deviceSubtype) return true;
  if (appUiTag === 'RenderableNode') {
    return deviceSubtype === 'Group' || deviceSubtype === 'RenderableNode';
  }
  return false;
}

/**
 * Resolve `steps` (from the app-ui `<screen>` element; `steps[0]` is the
 * scene itself) to a scene-rooted RALE path.
 */
export async function resolveRalePath(
  steps: PathStep[],
  fetch: ItemListFetcher,
): Promise<ResolveResult> {
  if (steps.length === 0) return { ok: false, error: 'Empty edit path.' };

  // RALE path [] is the scene — verify it matches the app-ui scene element.
  let current = await fetch([]);
  const sceneSubtype = current.item?.subtype;
  if (!subtypeCompatible(steps[0].subtype, sceneSubtype)) {
    return {
      ok: false,
      error: `Scene mismatch: the view shows <${steps[0].subtype}> but the device scene is `
        + `<${sceneSubtype ?? 'unknown'}>. Refresh and retry.`,
    };
  }

  const path: RalePathSegment[] = [];
  for (let depth = 1; depth < steps.length; depth++) {
    const step = steps[depth];
    const children = (current.childList ?? [])
      .map(entry => entry.item)
      .filter((item): item is RaleNodeItem => !!item);

    // Node id is the strongest anchor — app-ui tags are representations, not
    // always real subtypes, so match by id across ALL children first.
    let target: RaleNodeItem | undefined;
    if (step.id) {
      const byId = children.filter(
        item => item.id === step.id && subtypeCompatible(step.subtype, item.subtype),
      );
      if (byId.length === 1) target = byId[0];
    }
    target ??= children.filter(item => subtypeCompatible(step.subtype, item.subtype))[step.ordinal];

    if (!target || typeof target.index !== 'number') {
      const where = steps.slice(0, depth + 1).map(s => s.subtype).join(' > ');
      return {
        ok: false,
        error: `Could not locate <${step.subtype}>${step.id ? ` "${step.id}"` : ''} on the device `
          + `(at ${where}) — the tree may have changed. Refresh and retry.`,
      };
    }

    path.push({ child: target.index });
    if (depth < steps.length - 1) current = await fetch(path);
  }

  return { ok: true, path };
}
