import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClientOptions } from 'vscode-languageclient';
import { KopytkoLanguageClient } from '../languageClient';

export async function registerLanguageServer(
  context: vscode.ExtensionContext,
): Promise<KopytkoLanguageClient | undefined> {
  const config = vscode.workspace.getConfiguration('kopytko');
  if (!config.get<boolean>('languageServer.enabled', true)) {
    return undefined;
  }

  const serverModule = context.asAbsolutePath(path.join('out', 'server', 'server.js'));
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

  const client = new KopytkoLanguageClient(serverModule, clientOptions, context);
  await client.start();
  return client;
}
