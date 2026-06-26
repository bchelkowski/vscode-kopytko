import * as vscode from 'vscode';
import { DiagnosticsController } from '../diagnostics/diagnosticsController';
import { DiagnosticsViewProvider } from '../diagnostics/views/diagnosticsViewProvider';
import { DiscoveryServices } from './discovery';

/**
 * Registers the diagnostics panel (WebviewViewProvider), controller, and
 * the Start/Stop commands that can also be invoked from the Command Palette.
 */
export function registerDiagnostics(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): DiagnosticsController {
  const controller = new DiagnosticsController({
    deviceManager: services.deviceManager,
    ecp: services.ecp,
    rendezvousManager: services.rendezvousManager,
    workspaceRoot: services.workspaceRoot,
  });

  const provider = new DiagnosticsViewProvider(context, controller);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DiagnosticsViewProvider.viewId,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    { dispose: () => { controller.dispose(); provider.dispose(); } },

    vscode.commands.registerCommand('kopytko.diagnostics.startSession', async () => {
      if (controller.isRecording) {
        vscode.window.showInformationMessage('Kopytko Diagnostics: a session is already running.');
        return;
      }
      try {
        const session = await controller.startSession();
        if (session) {
          provider.notifyStateChange();
          vscode.window.showInformationMessage(
            `Kopytko Diagnostics: recording to ${session.dir}`,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Kopytko Diagnostics: failed to start — ${(err as Error).message}`,
        );
      }
    }),

    vscode.commands.registerCommand('kopytko.diagnostics.stopSession', async () => {
      if (!controller.isRecording) {
        vscode.window.showInformationMessage('Kopytko Diagnostics: no session is running.');
        return;
      }
      const dir = controller.activeSession?.dir;
      await controller.stopSession();
      provider.notifyStateChange();
      vscode.window.showInformationMessage(
        dir
          ? `Kopytko Diagnostics: session saved to ${dir}`
          : 'Kopytko Diagnostics: session stopped.',
      );
    }),
  );

  return controller;
}
