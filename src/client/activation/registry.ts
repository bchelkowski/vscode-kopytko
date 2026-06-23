import * as vscode from 'vscode';
import { DeviceTreeItem } from '../roku/views/deviceTreeItems';
import { RegistryContentProvider, parseRegistryXml, formatRegistryAsJson } from '../roku/views/registryProvider';
import { DiscoveryServices } from './discovery';

export function registerRegistry(context: vscode.ExtensionContext, services: DiscoveryServices): void {
  const { deviceManager, ecp } = services;
  const registryProvider = new RegistryContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('roku-registry', registryProvider),
    vscode.commands.registerCommand('kopytko.readRegistry', async (serialOrItem: unknown) => {
      let serial: string | undefined;
      if (serialOrItem instanceof DeviceTreeItem) {
        serial = serialOrItem.device.serialNumber;
      } else if (typeof serialOrItem === 'string') {
        serial = serialOrItem;
      }

      const device = serial ? deviceManager.getDevice(serial) : undefined;
      if (!device) {
        vscode.window.showErrorMessage('No device selected');
        return;
      }

      let apps: { id: string; name: string }[] = [];
      try {
        apps = await ecp.queryApps(device.ip);
      } catch {
        // Fall back to just "dev" if app list query fails
      }

      const devApp = apps.find((a) => a.id === 'dev');
      const channelApps = apps.filter((a) => a.id !== 'dev');
      const items: vscode.QuickPickItem[] = [
        { label: 'dev', description: devApp?.name ?? 'Sideloaded App' },
        ...channelApps.map((app) => ({ label: app.id, description: app.name })),
      ];

      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a channel to read its registry' });
      if (!selected) return;

      const channelId = selected.label;
      try {
        const xml = await ecp.queryRegistry(device.ip, channelId);
        const data = parseRegistryXml(xml);

        if (data.status === 'FAILED') {
          vscode.window.showInformationMessage(
            `Cannot read registry for "${selected.description}" (${channelId}): ${data.error ?? 'access denied'}`,
          );
          return;
        }

        if (data.sections.length === 0) {
          vscode.window.showInformationMessage(
            `Registry for "${selected.description}" (${channelId}) on ${device.friendlyName} is empty.`,
          );
          return;
        }

        const content = formatRegistryAsJson(data, channelId, device.friendlyName);
        const uri = vscode.Uri.parse(`roku-registry://registry/${encodeURIComponent(device.friendlyName)}-${channelId}.json`);
        registryProvider.setContent(uri, content);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
        await vscode.languages.setTextDocumentLanguage(doc, 'json');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to read registry: ${msg}`);
      }
    }),
  );
}
