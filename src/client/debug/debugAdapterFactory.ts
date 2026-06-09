import * as vscode from 'vscode';
import { BrightScriptDebugAdapter } from './brightScriptDebugAdapter';

export class BrightScriptDebugAdapterFactory
  implements vscode.DebugAdapterDescriptorFactory {

  private readonly _outputChannel: vscode.OutputChannel;

  constructor() {
    this._outputChannel = vscode.window.createOutputChannel('BrightScript Debug');
  }

  createDebugAdapterDescriptor(
    _session: vscode.DebugSession
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(
      new BrightScriptDebugAdapter(this._outputChannel)
    );
  }

  dispose(): void {
    this._outputChannel.dispose();
  }
}
