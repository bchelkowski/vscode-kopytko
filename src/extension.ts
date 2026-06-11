import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClientOptions } from 'vscode-languageclient';
import { KopytkoLanguageClient } from './client/languageClient';
import { SsdpClient } from './client/roku/ssdp/ssdpClient';
import { EcpClient } from './client/roku/discovery/ecpClient';
import { DeviceManager } from './client/roku/discovery/deviceManager';
import { NetworkMonitor } from './client/roku/discovery/networkMonitor';
import { DeviceStore } from './client/roku/persistence/deviceStore';
import { CredentialStore } from './client/roku/persistence/credentialStore';
import { DeviceTreeProvider } from './client/roku/views/deviceTreeProvider';
import { DeviceTreeItem } from './client/roku/views/deviceTreeItems';
import { BrightScriptDebugAdapterFactory } from './client/debug/debugAdapterFactory';

let client: KopytkoLanguageClient | undefined;
let deviceManager: DeviceManager | undefined;
let treeProvider: DeviceTreeProvider | undefined;
let debugFactory: BrightScriptDebugAdapterFactory | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // ── Language server ──────────────────────────────────────────────────────
  const config = vscode.workspace.getConfiguration('kopytko');
  if (config.get<boolean>('languageServer.enabled', true)) {
    const serverModule = context.asAbsolutePath(
      path.join('out', 'server', 'server.js')
    );
    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'file', language: 'brightscript' },
        { scheme: 'file', pattern: '**/.kopytkorc' },
      ],
      synchronize: {
        fileEvents: [
          vscode.workspace.createFileSystemWatcher('**/*.brs'),
          vscode.workspace.createFileSystemWatcher('**/*.xml'),
          vscode.workspace.createFileSystemWatcher('**/.kopytkorc'),
          vscode.workspace.createFileSystemWatcher('**/package.json'),
        ],
      },
      outputChannelName: 'Kopytko BrightScript',
      traceOutputChannel: vscode.window.createOutputChannel('Kopytko BrightScript (Trace)', { log: true }),
    };
    client = new KopytkoLanguageClient(serverModule, clientOptions, context);
    await client.start();
  }

  // ── Roku device discovery ───────────────────────────────────────────────
  const discoveryEnabled = config.get<boolean>('deviceDiscovery.enabled', true);

  const ssdp = new SsdpClient();
  const ecp = new EcpClient();
  const store = new DeviceStore(context.globalState);
  const credentials = new CredentialStore(context.secrets);
  const networkMonitor = new NetworkMonitor();

  deviceManager = new DeviceManager(ssdp, ecp, store, credentials, networkMonitor);
  treeProvider = new DeviceTreeProvider(deviceManager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kopytko.rokuDevices', treeProvider)
  );

  if (discoveryEnabled) {
    deviceManager.initialize();
  }

  // ── Device commands ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.refreshDevices', () =>
      deviceManager!.scan()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.selectDevice', async (item: unknown) => {
      if (item instanceof DeviceTreeItem) {
        await deviceManager!.setActiveDevice(item.device.serialNumber);
        vscode.window.showInformationMessage(
          `Active device set to ${item.device.friendlyName} (${item.device.ip})`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.addDevice', async () => {
      const ip = await vscode.window.showInputBox({
        prompt: 'Enter the IP address of the Roku device',
        placeHolder: '192.168.1.100',
        validateInput: (value) => {
          if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
            return 'Enter a valid IPv4 address';
          }
          return undefined;
        },
      });
      if (!ip) return;

      try {
        const device = await deviceManager!.addManualDevice(ip);
        vscode.window.showInformationMessage(
          `Added ${device.friendlyName} (${device.ip})`
        );
      } catch {
        vscode.window.showErrorMessage(
          `Could not reach a Roku device at ${ip}. Verify the IP and that the device is on.`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.toggleFavorite', async (item: unknown) => {
      if (item instanceof DeviceTreeItem) {
        const newState = !item.device.isFavorite;
        await deviceManager!.setFavorite(item.device.serialNumber, newState);
        vscode.window.showInformationMessage(
          newState
            ? `★ ${item.device.friendlyName} added to favorites`
            : `☆ ${item.device.friendlyName} removed from favorites`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.setDevicePassword', async (item: unknown) => {
      if (!(item instanceof DeviceTreeItem)) return;
      const { device } = item;

      const password = await vscode.window.showInputBox({
        prompt: `Enter developer password for ${device.friendlyName}`,
        password: true,
      });
      if (password === undefined) return;

      const valid = await ecp.validatePassword(device.ip, password);
      if (valid) {
        await credentials.setPassword(device.serialNumber, password);
        vscode.window.showInformationMessage(
          `✓ Password verified and saved for ${device.friendlyName}`
        );
      } else {
        const saveAnyway = await vscode.window.showWarningMessage(
          `Password could not be verified against ${device.friendlyName}. Save anyway?`,
          'Save', 'Cancel'
        );
        if (saveAnyway === 'Save') {
          await credentials.setPassword(device.serialNumber, password);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.clearDevicePassword', async (item: unknown) => {
      if (!(item instanceof DeviceTreeItem)) return;
      await credentials.deletePassword(item.device.serialNumber);
      vscode.window.showInformationMessage(
        `Password cleared for ${item.device.friendlyName}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.copyDeviceIp', (item: unknown) => {
      if (item instanceof DeviceTreeItem) {
        vscode.env.clipboard.writeText(item.device.ip);
        vscode.window.showInformationMessage(`Copied ${item.device.ip}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.openDevicePortal', (serialOrItem: unknown) => {
      let ip: string | undefined;
      if (serialOrItem instanceof DeviceTreeItem) {
        ip = serialOrItem.device.ip;
      } else if (typeof serialOrItem === 'string') {
        ip = deviceManager!.getDevice(serialOrItem)?.ip;
      }
      if (ip) {
        vscode.env.openExternal(vscode.Uri.parse(`http://${ip}`));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.removeDevice', async (item: unknown) => {
      if (!(item instanceof DeviceTreeItem)) return;
      const { device } = item;
      const confirm = await vscode.window.showWarningMessage(
        `Remove ${device.friendlyName} from saved devices?`,
        'Remove', 'Cancel'
      );
      if (confirm === 'Remove') {
        await deviceManager!.setFavorite(device.serialNumber, false);
        deviceManager!.removeDevice(device.serialNumber);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.copyToClipboard', (value: unknown) => {
      if (typeof value === 'string') {
        vscode.env.clipboard.writeText(value);
      }
    })
  );

  // ── BrightScript debug adapter ───────────────────────────────────────────
  debugFactory = new BrightScriptDebugAdapterFactory();
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('kopytko', debugFactory)
  );

  // Auto-fill host/password from the active device when launching
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('kopytko', {
      async resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        debugConfig: vscode.DebugConfiguration
      ): Promise<vscode.DebugConfiguration | undefined> {
        const active = deviceManager?.getActiveDevice();
        if (active) {
          if (!debugConfig['host']) debugConfig['host'] = active.ip;
          if (!debugConfig['password']) {
            const stored = await credentials.getPassword(active.serialNumber);
            if (stored) debugConfig['password'] = stored;
          }
        }
        if (!debugConfig['rootDir']) {
          debugConfig['rootDir'] = _folder?.uri.fsPath ?? '';
        }
        return debugConfig;
      },
    })
  );
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
  treeProvider?.dispose();
  deviceManager?.dispose();
  debugFactory?.dispose();
}
