/**
 * Message protocol for the SceneGraph Tree panel.
 * No imports except the webview-local xmlDiff types — bundled separately for
 * the webview context.
 */

import type { FieldEdit } from './xmlDiff';

/** Which node collection to fetch from the device. */
export type NodeCollection = 'all' | 'roots' | 'ui';

export type ExtMsg =
  | { kind: 'loading' }
  | { kind: 'tree'; xml: string; device: string; channelTitle: string; collection: NodeCollection }
  | { kind: 'error'; message: string }
  | { kind: 'edit-state'; active: boolean; raleVersion?: string; error?: string }
  | {
      kind: 'apply-result';
      ok: boolean;
      applied: number;
      failures: { field: string; path: number[]; message: string }[];
      /** Edits that applied but may not behave as expected (e.g. a
       *  translation on a LayoutGroup child, which the layout overwrites). */
      warnings?: string[];
    };

export type WebMsg =
  | { kind: 'refresh'; collection: NodeCollection }
  | { kind: 'copy'; text: string }
  | { kind: 'edit-enter' }
  | { kind: 'edit-exit' }
  | { kind: 'apply-edits'; edits: FieldEdit[] };
