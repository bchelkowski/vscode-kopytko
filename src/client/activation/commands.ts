import * as vscode from 'vscode';
import { DeviceTreeItem, DeviceEnvironmentItem } from '../roku/views/deviceTreeItems';
import { getAvailableEnvironments } from 'kopytko-roku-device';
import { upload } from 'kopytko-roku-device';
import { RokuDevice } from 'kopytko-roku-device';
import { DiscoveryServices } from './discovery';

export function registerCommands(context: vscode.ExtensionContext, services: DiscoveryServices): void {
  const { deviceManager, ecp, credentials, discoveryChannel, workspaceRoot } = services;

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.refreshDevices', () => deviceManager.scan()),
    vscode.commands.registerCommand('kopytko.selectDevice', async (item: unknown) => {
      if (item instanceof DeviceTreeItem) {
        await deviceManager.setActiveDevice(item.device.serialNumber);
        vscode.window.showInformationMessage(`Active device set to ${item.device.friendlyName} (${item.device.ip})`);
      }
    }),
    vscode.commands.registerCommand('kopytko.unselectDevice', async (item: unknown) => {
      if (item instanceof DeviceTreeItem) {
        await deviceManager.setActiveDevice(undefined);
        vscode.window.showInformationMessage('Active device cleared');
      }
    }),
    vscode.commands.registerCommand('kopytko.addDevice', async () => {
      const ip = await vscode.window.showInputBox({
        prompt: 'Enter the IP address of the Roku device',
        placeHolder: '192.168.1.100',
        validateInput: (value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? undefined : 'Enter a valid IPv4 address',
      });
      if (!ip) return;

      try {
        const device = await deviceManager.addManualDevice(ip);
        vscode.window.showInformationMessage(`Added ${device.friendlyName} (${device.ip})`);
      } catch (err) {
        let detail = '';
        if (err instanceof Error) {
          if (err.message.includes('timed out')) {
            detail = ' The device did not respond within 3 seconds.';
          } else if (err.message.includes('ECONNREFUSED')) {
            detail = ' Connection refused — ECP may not be enabled on this device.';
          } else {
            detail = ` (${err.message})`;
          }
        }
        discoveryChannel.appendLine(`Add device failed for ${ip}: ${err instanceof Error ? err.message : String(err)}`);
        vscode.window.showErrorMessage(`Could not reach a Roku device at ${ip}.${detail} Check the "Roku Discovery" output for details.`);
      }
    }),
    vscode.commands.registerCommand('kopytko.addFavorite', async (item: unknown) => {
      if (item instanceof DeviceTreeItem) {
        await deviceManager.setFavorite(item.device.serialNumber, true);
        vscode.window.showInformationMessage(`★ ${item.device.friendlyName} added to favorites`);
      }
    }),
    vscode.commands.registerCommand('kopytko.removeFavorite', async (item: unknown) => {
      if (item instanceof DeviceTreeItem) {
        await deviceManager.setFavorite(item.device.serialNumber, false);
        vscode.window.showInformationMessage(`☆ ${item.device.friendlyName} removed from favorites`);
      }
    }),
    vscode.commands.registerCommand('kopytko.setDevicePassword', async (item: unknown) => {
      if (!(item instanceof DeviceTreeItem)) return;
      const { device } = item;
      const password = await vscode.window.showInputBox({
        prompt: `Enter developer password for ${device.friendlyName}`,
        password: true,
      });
      if (password === undefined) return;

      const valid = await ecp.validatePassword(device.ip, password);
      const deviceKey = device.deviceId || device.serialNumber;
      if (valid) {
        await credentials.setPassword(deviceKey, password);
        vscode.window.showInformationMessage(`✓ Password verified and saved for ${device.friendlyName}`);
      } else {
        const saveAnyway = await vscode.window.showWarningMessage(
          `Password could not be verified against ${device.friendlyName}. Save anyway?`,
          'Save', 'Cancel',
        );
        if (saveAnyway === 'Save') {
          await credentials.setPassword(deviceKey, password);
        }
      }
    }),
    vscode.commands.registerCommand('kopytko.clearDevicePassword', async (item: unknown) => {
      if (!(item instanceof DeviceTreeItem)) return;
      const { device } = item;
      await credentials.deletePassword(device.deviceId || device.serialNumber);
      vscode.window.showInformationMessage(`Password cleared for ${device.friendlyName}`);
    }),
    vscode.commands.registerCommand('kopytko.copyDeviceIp', (item: unknown) => {
      if (item instanceof DeviceTreeItem) {
        vscode.env.clipboard.writeText(item.device.ip);
        vscode.window.showInformationMessage(`Copied ${item.device.ip}`);
      }
    }),
    vscode.commands.registerCommand('kopytko.openDevicePortal', (serialOrItem: unknown) => {
      let ip: string | undefined;
      if (serialOrItem instanceof DeviceTreeItem) {
        ip = serialOrItem.device.ip;
      } else if (typeof serialOrItem === 'string') {
        ip = deviceManager.getDevice(serialOrItem)?.ip;
      }
      if (ip) {
        vscode.env.openExternal(vscode.Uri.parse(`http://${ip}`));
      }
    }),
    vscode.commands.registerCommand('kopytko.removeDevice', async (item: unknown) => {
      if (!(item instanceof DeviceTreeItem)) return;
      const { device } = item;
      const confirm = await vscode.window.showWarningMessage(
        `Remove ${device.friendlyName} from saved devices?`,
        'Remove', 'Cancel',
      );
      if (confirm === 'Remove') {
        await deviceManager.setFavorite(device.serialNumber, false);
        deviceManager.removeDevice(device.serialNumber);
      }
    }),
    vscode.commands.registerCommand('kopytko.copyToClipboard', (value: unknown) => {
      if (typeof value === 'string') {
        vscode.env.clipboard.writeText(value);
      }
    }),
    vscode.commands.registerCommand('kopytko.setDeviceEnvironment', async (serialOrItem: unknown) => {
      let serial: string | undefined;
      if (serialOrItem instanceof DeviceEnvironmentItem) {
        serial = serialOrItem.serialNumber;
      } else if (typeof serialOrItem === 'string') {
        serial = serialOrItem;
      } else if (serialOrItem instanceof DeviceTreeItem) {
        serial = serialOrItem.device.serialNumber;
      }
      if (!serial) return;

      const envs = getAvailableEnvironments(workspaceRoot);
      if (envs.length === 0) {
        vscode.window.showWarningMessage('No environments found in .kopytkorc. Add an "environments" section to your .kopytkorc file.');
        return;
      }

      const currentEnv = deviceManager.getDeviceEnvironment(serial);
      const selected = await vscode.window.showQuickPick(
        envs.map(e => ({ label: e, description: e === currentEnv ? '(current)' : undefined })),
        { placeHolder: 'Select environment for this device' },
      );
      if (!selected) return;

      await deviceManager.setDeviceEnvironment(serial, selected.label);
      vscode.window.showInformationMessage(
        `Environment set to "${selected.label}" for ${deviceManager.getDevice(serial)?.friendlyName ?? serial}`,
      );
    }),
    vscode.commands.registerCommand('kopytko.uploadToDevice', async (item: unknown) => {
      let device: RokuDevice;
      if (item instanceof DeviceTreeItem) {
        device = item.device;
      } else {
        const active = deviceManager.getActiveDevice();
        if (!active) {
          vscode.window.showErrorMessage('No active device. Select a device first (right-click → Select Active Device).');
          return;
        }
        device = active;
      }

      const deviceKey = device.deviceId || device.serialNumber;
      const password = await credentials.getPassword(deviceKey);
      if (!password) {
        vscode.window.showErrorMessage(`No password stored for ${device.friendlyName}. Set a password first (right-click → Set Password).`);
        return;
      }

      const availableEnvs = getAvailableEnvironments(workspaceRoot);
      const env = deviceManager.getEffectiveEnvironment(device.serialNumber, availableEnvs);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Uploading to ${device.friendlyName}…`, cancellable: false },
        async (progress) => {
          try {
            await upload({
              rootDir: workspaceRoot,
              host: device.ip,
              password,
              env,
              onOutput: (msg) => {
                progress.report({ message: msg });
                discoveryChannel.appendLine(`[Upload] ${msg}`);
              },
            });
            vscode.window.showInformationMessage(`Successfully uploaded to ${device.friendlyName}` + (env ? ` (env: ${env})` : ''));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            discoveryChannel.appendLine(`[Upload] Failed: ${msg}`);
            vscode.window.showErrorMessage(`Upload failed: ${msg}`);
          }
        },
      );
    }),
    vscode.commands.registerCommand('kopytko.debugDevice', async (item: unknown) => {
      let device: RokuDevice;
      if (item instanceof DeviceTreeItem) {
        device = item.device;
      } else {
        const active = deviceManager.getActiveDevice();
        if (!active) {
          vscode.window.showErrorMessage('No active device. Select a device first (right-click → Select Active Device).');
          return;
        }
        device = active;
      }

      const deviceKey = device.deviceId || device.serialNumber;
      const password = await credentials.getPassword(deviceKey);
      if (!password) {
        vscode.window.showErrorMessage(`No password stored for ${device.friendlyName}. Set a password first (right-click → Set Password).`);
        return;
      }

      const availableEnvs = getAvailableEnvironments(workspaceRoot);
      const env = deviceManager.getEffectiveEnvironment(device.serialNumber, availableEnvs);
      const folder = vscode.workspace.workspaceFolders?.[0];
      await vscode.debug.startDebugging(folder, {
        type: 'kopytko',
        request: 'launch',
        name: 'Debug on Roku',
        host: device.ip,
        password,
        ...(env ? { env } : {}),
      });
    }),
  );
}
