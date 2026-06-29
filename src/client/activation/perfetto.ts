import * as vscode from 'vscode';
import { PerfettoController } from '../perfetto/perfettoController';
import { PerfettoEditorPanel } from '../perfetto/views/perfettoEditorPanel';
import type { DiscoveryServices } from './discovery';

/**
 * Registers the Kopytko Perfetto editor-tab panel, controller, and commands.
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

  context.subscriptions.push(
    { dispose: () => { controller.dispose(); PerfettoEditorPanel.instance?.dispose(); } },

    // Opens (or focuses) the Perfetto editor tab.
    vscode.commands.registerCommand('kopytko.perfetto.open', () => {
      PerfettoEditorPanel.createOrReveal(context, controller);
    }),

    vscode.commands.registerCommand('kopytko.perfetto.startSession', async () => {
      const panel = PerfettoEditorPanel.createOrReveal(context, controller);
      if (controller.isRecording) {
        vscode.window.showInformationMessage('Kopytko Perfetto: a session is already running.');
        return;
      }
      try {
        const session = await controller.startSession();
        if (session) {
          panel.notifyStateChange();
          vscode.window.showInformationMessage(`Kopytko Perfetto: recording to ${session.dir}`);
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
      PerfettoEditorPanel.instance?.notifyStateChange();
      vscode.window.showInformationMessage(
        dir ? `Kopytko Perfetto: session saved to ${dir}` : 'Kopytko Perfetto: session stopped.',
      );
    }),

    vscode.commands.registerCommand('kopytko.perfetto.captureHeapSnapshot', () => {
      void controller.captureHeapSnapshot();
    }),
  );

  return controller;
}
