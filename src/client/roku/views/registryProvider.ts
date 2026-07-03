import * as vscode from 'vscode';
import type { RegistryData } from 'kopytko-roku-device';

// The ECP response parsing (parseRegistryXml, RegistryData, RegistrySection)
// lives in kopytko-roku-device; this module keeps the presentation side.
export { parseRegistryXml, type RegistryData, type RegistrySection } from 'kopytko-roku-device';

/**
 * Formats parsed registry data as a readable JSON document.
 */
export function formatRegistryAsJson(data: RegistryData, channelId: string, deviceName: string): string {
  const doc: Record<string, unknown> = {
    device: deviceName,
    channelId,
    devId: data.devId,
    plugins: data.plugins,
    spaceAvailable: data.spaceAvailable + ' bytes',
    sections: {} as Record<string, Record<string, string>>,
  };

  for (const section of data.sections) {
    const entries: Record<string, string> = {};
    for (const item of section.items) {
      entries[item.key] = item.value;
    }
    (doc.sections as Record<string, Record<string, string>>)[section.name] = entries;
  }

  return JSON.stringify(doc, null, 2);
}

/**
 * Virtual document content provider for `roku-registry:` URIs.
 * Stores registry content in memory, keyed by URI.
 */
export class RegistryContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private _contents = new Map<string, string>();

  setContent(uri: vscode.Uri, content: string): void {
    this._contents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._contents.get(uri.toString()) ?? '';
  }
}
