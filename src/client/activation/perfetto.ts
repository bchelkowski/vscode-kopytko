import * as vscode from 'vscode';
import { PerfettoController } from '../perfetto/perfettoController';
import { PerfettoViewProvider } from '../perfetto/views/perfettoViewProvider';
import type { DiscoveryServices } from './discovery';

/**
 * Registers the Kopytko Perfetto panel (WebviewViewProvider), controller, and
 * the Start/Stop/Heap commands that can also be invoked from the Command Palette.
 */
export function registerPerfetto(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): PerfettoController {
  const controller = new PerfettoController({
    deviceManager: services.deviceManager,
    ecp: services.ecp,
    credentials: services.credentials,
    workspaceRoot: services.workspaceRoot,
  });

  const provider = new PerfettoViewProvider(context, controller);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PerfettoViewProvider.viewId,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    { dispose: () => { controller.dispose(); provider.dispose(); } },

    vscode.commands.registerCommand('kopytko.perfetto.startSession', async () => {
      if (controller.isRecording) {
        vscode.window.showInformationMessage('Kopytko Perfetto: a session is already running.');
        return;
      }
      try {
        const session = await controller.startSession();
        if (session) {
          provider.notifyStateChange();
          vscode.window.showInformationMessage(
            `Kopytko Perfetto: recording to ${session.dir}`,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Kopytko Perfetto: failed to start — ${(err as Error).message}`,
        );
      }
    }),

    vscode.commands.registerCommand('kopytko.perfetto.stopSession', async () => {
      if (!controller.isRecording) {
        vscode.window.showInformationMessage('Kopytko Perfetto: no session is running.');
        return;
      }
      const dir = controller.activeSession?.dir;
      await controller.stopSession();
      provider.notifyStateChange();
      vscode.window.showInformationMessage(
        dir
          ? `Kopytko Perfetto: session saved to ${dir}`
          : 'Kopytko Perfetto: session stopped.',
      );
    }),

    vscode.commands.registerCommand('kopytko.perfetto.captureHeapSnapshot', () => {
      void controller.captureHeapSnapshot();
    }),
  );

  return controller;
}
