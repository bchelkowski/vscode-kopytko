import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClientOptions } from 'vscode-languageclient';
import { KopytkoLanguageClient } from './client/languageClient';
import { RokuDeviceProvider } from './client/roku/deviceProvider';
import { BrightScriptDebugAdapterFactory } from './client/debug/debugAdapterFactory';

let client: KopytkoLanguageClient | undefined;
let deviceProvider: RokuDeviceProvider | undefined;
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

  // ── Roku device tree view ────────────────────────────────────────────────
  deviceProvider = new RokuDeviceProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kopytko.rokuDevices', deviceProvider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.refreshDevices', () =>
      deviceProvider!.refresh()
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('kopytko.selectDevice', (item) =>
      deviceProvider!.selectDevice(item)
    )
  );

  // ── BrightScript debug adapter ───────────────────────────────────────────
  debugFactory = new BrightScriptDebugAdapterFactory();
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('kopytko', debugFactory)
  );

  // Auto-fill host/password from the selected device when launching
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('kopytko', {
      resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration
      ): vscode.ProviderResult<vscode.DebugConfiguration> {
        const active = deviceProvider?.getActiveDevice();
        if (active) {
          if (!config['host']) config['host'] = active.ip;
        }
        if (!config['rootDir']) {
          config['rootDir'] = _folder?.uri.fsPath ?? '';
        }
        return config;
      },
    })
  );
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
  debugFactory?.dispose();
}
