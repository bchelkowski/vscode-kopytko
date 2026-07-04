import * as vscode from 'vscode';
import { KopytkoLanguageClient } from './client/languageClient';
import { DeviceManager } from 'kopytko-roku-device';
import { DeviceTreeProvider } from './client/roku/views/deviceTreeProvider';
import { BrightScriptDebugAdapterFactory } from './client/debug/debugAdapterFactory';
import { registerLanguageServer } from './client/activation/languageServer';
import { registerDiscovery } from './client/activation/discovery';
import { registerCommands } from './client/activation/commands';
import { registerRegistry } from './client/activation/registry';
import { registerDiagnostics } from './client/activation/diagnostics';
import { registerPerfetto } from './client/activation/perfetto';
import { registerNodes } from './client/activation/nodes';
import { registerDeepLinking } from './client/activation/deepLinking';
import { registerDebug } from './client/activation/debug';
import { registerNav } from './client/activation/nav';

let client: KopytkoLanguageClient | undefined;
let deviceManager: DeviceManager | undefined;
let treeProvider: DeviceTreeProvider | undefined;
let debugFactory: BrightScriptDebugAdapterFactory | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = await registerLanguageServer(context);

  const discovery = registerDiscovery(context);
  deviceManager = discovery.deviceManager;
  treeProvider = discovery.treeProvider;

  registerCommands(context, discovery);
  registerRegistry(context, discovery);
  registerDiagnostics(context, discovery);
  registerPerfetto(context, discovery);
  registerNodes(context, discovery);
  registerDeepLinking(context, discovery);
  registerNav(context);
  debugFactory = registerDebug(context, discovery);
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
