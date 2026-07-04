/**
 * Message protocol between the extension host and the Kopytko Tools nav
 * webview. Zero imports so it can be bundled without pulling in Node/VS Code APIs.
 */

export type NavTarget = 'diagnostics' | 'perfetto' | 'nodes' | 'deepLinking';

export type WebMsg = { kind: 'open'; target: NavTarget };
