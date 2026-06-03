import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

/**
 * Wraps the VSCode LanguageClient with Kopytko-specific setup and lifecycle management.
 */
export class KopytkoLanguageClient {
  private readonly client: LanguageClient;

  constructor(
    serverModule: string,
    clientOptions: LanguageClientOptions,
    _context: vscode.ExtensionContext
  ) {
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: debugOptions,
      },
    };

    const traceValue = vscode.workspace
      .getConfiguration('kopytko')
      .get<string>('languageServer.trace', 'off');

    this.client = new LanguageClient(
      'kopytko',
      'Kopytko BrightScript',
      serverOptions,
      {
        ...clientOptions,
        initializationOptions: {
          trace: traceValue,
          sourceDir: vscode.workspace
            .getConfiguration('kopytko')
            .get<string>('imports.sourceDir', 'app'),
          resolveModules: vscode.workspace
            .getConfiguration('kopytko')
            .get<boolean>('imports.resolveModules', true),
          workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(
            (f) => f.uri.fsPath
          ),
        },
      }
    );
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  get rawClient(): LanguageClient {
    return this.client;
  }

  /** Path to the server module resolved relative to the extension install dir. */
  static resolveServerPath(extensionPath: string): string {
    return path.join(extensionPath, 'out', 'server', 'server.js');
  }
}
