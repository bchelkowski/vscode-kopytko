import * as vscode from 'vscode';
import { SsdpClient, EcpClient, DeviceManager } from 'kopytko-roku-device';
import { getAvailableEnvironments } from '../roku/kopytkorc';
import { NetworkMonitor } from '../roku/discovery/networkMonitor';
import { DeviceStore } from '../roku/persistence/deviceStore';
import { CredentialStore } from '../roku/persistence/credentialStore';
import { DeviceTreeProvider } from '../roku/views/deviceTreeProvider';
import { RendezvousManager } from '../roku/rendezvous/rendezvousManager';

export interface DiscoveryServices {
  deviceManager: DeviceManager;
  treeProvider: DeviceTreeProvider;
  ecp: EcpClient;
  credentials: CredentialStore;
  discoveryChannel: vscode.OutputChannel;
  workspaceRoot: string;
  rendezvousManager: RendezvousManager;
}

export function registerDiscovery(context: vscode.ExtensionContext): DiscoveryServices {
  const config = vscode.workspace.getConfiguration('kopytko');
  const discoveryEnabled = config.get<boolean>('deviceDiscovery.enabled', true);
  const scanTimeout = config.get<number>('deviceDiscovery.scanTimeout', 5000);
  const showNotifications = config.get<boolean>('deviceDiscovery.showNotifications', true);

  const ssdp = new SsdpClient();
  const ecp = new EcpClient();
  const store = new DeviceStore(context.globalState);
  const credentials = new CredentialStore(context.secrets);
  const networkMonitor = new NetworkMonitor();
  const discoveryChannel = vscode.window.createOutputChannel('Roku Discovery');
  context.subscriptions.push(discoveryChannel);

  const deviceManager = new DeviceManager(ssdp, ecp, store, networkMonitor, discoveryChannel, {
    scanTimeout,
    showNotifications,
    notify: (msg) => vscode.window.showInformationMessage(msg),
  });
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const treeProvider = new DeviceTreeProvider(deviceManager, () => getAvailableEnvironments(workspaceRoot));
  const rendezvousManager = new RendezvousManager(deviceManager, ecp, workspaceRoot, context.workspaceState);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kopytko.rokuDevices', treeProvider),
    { dispose: () => rendezvousManager.dispose() },
  );

  if (discoveryEnabled) {
    deviceManager.initialize();
  }

  return { deviceManager, treeProvider, ecp, credentials, discoveryChannel, workspaceRoot, rendezvousManager };
}
