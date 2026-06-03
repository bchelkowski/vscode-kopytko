import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClientOptions } from 'vscode-languageclient';
import { KopytkoLanguageClient } from './client/languageClient';

let client: KopytkoLanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('kopytko');
  if (!config.get<boolean>('languageServer.enabled', true)) {
    return;
  }

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
        vscode.workspace.createFileSystemWatcher('**/*.bs'),
        vscode.workspace.createFileSystemWatcher('**/.kopytkorc'),
        vscode.workspace.createFileSystemWatcher('**/package.json'),
      ],
    },
    outputChannelName: 'Kopytko BrightScript',
    traceOutputChannel: vscode.window.createOutputChannel('Kopytko BrightScript (Trace)'),
  };

  client = new KopytkoLanguageClient(serverModule, clientOptions, context);
  await client.start();
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
