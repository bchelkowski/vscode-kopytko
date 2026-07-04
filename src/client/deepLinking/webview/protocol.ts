// Message protocol between the Deep Linking panel host and its webview.
// Deliberately import-free: this file is shared by the browser bundle.

export interface ChannelInfo {
  id: string;
  name: string;
  version?: string;
  iconDataUri?: string;
}

export interface DeepLinkParam {
  key: string;
  value: string;
}

export interface SavedSet {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  contentId: string;
  params: DeepLinkParam[];
  updatedAt: number;
}

export type SendMode = 'launch' | 'input';

/** Extension host → webview. */
export type ExtMsg =
  | { kind: 'loading' }
  | { kind: 'channels'; device: string; deviceName: string; channels: ChannelInfo[] }
  | { kind: 'noDevice' }
  | { kind: 'sets'; sets: SavedSet[] }
  | { kind: 'sendResult'; ok: boolean; mode: SendMode; message?: string }
  | { kind: 'error'; message: string };

/** Webview → extension host. */
export type WebMsg =
  | { kind: 'refresh' }
  | { kind: 'send'; mode: SendMode; channelId: string; contentId: string; params: DeepLinkParam[] }
  | { kind: 'saveSet'; set: { id?: string; name: string; channelId: string; channelName: string; contentId: string; params: DeepLinkParam[] } }
  | { kind: 'deleteSet'; id: string };
