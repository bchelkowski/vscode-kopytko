/**
 * Message protocol for the SceneGraph Node Explorer panel.
 * No imports — bundled separately for the webview context.
 */

export type ExtMsg =
  | { kind: 'loading' }
  | { kind: 'tree'; xml: string; device: string; channelTitle: string }
  | { kind: 'error'; message: string };

export type WebMsg =
  | { kind: 'refresh' };
