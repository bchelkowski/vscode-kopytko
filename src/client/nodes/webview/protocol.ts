/**
 * Message protocol for the SceneGraph Tree panel.
 * No imports — bundled separately for the webview context.
 */

/** Which node collection to fetch from the device. */
export type NodeCollection = 'all' | 'roots' | 'ui';

export type ExtMsg =
  | { kind: 'loading' }
  | { kind: 'tree'; xml: string; device: string; channelTitle: string; collection: NodeCollection }
  | { kind: 'error'; message: string };

export type WebMsg =
  | { kind: 'refresh'; collection: NodeCollection }
  | { kind: 'copy'; text: string };
