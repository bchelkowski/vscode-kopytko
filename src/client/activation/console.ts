import * as vscode from 'vscode';
import { CONSOLE_PORT_LABELS, CONSOLE_PORTS, completeCommand, type ConsolePort } from 'kopytko-roku-device';
import { ConsoleController } from '../console/consoleController';
import { ConsoleViewProvider, readSettings } from '../console/views/consoleViewProvider';
import { DiscoveryServices } from './discovery';

/**
 * Registers the Kopytko Console panel — an interactive terminal for the Roku
 * debug consoles (ports 8085 and 8080) — plus its commands.
 */
export function registerConsole(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): ConsoleController {
  const settings = readSettings();

  const controller = new ConsoleController(
    { deviceManager: services.deviceManager, workspaceRoot: services.workspaceRoot },
    {
      maxLines: settings.maxLines,
      reconnect: settings.reconnect,
      logToFile: settings.logToFile,
      outputDir: settings.outputDir,
      historySize: settings.historySize,
    },
  );
  controller.selectPort(settings.defaultPort);

  const provider = new ConsoleViewProvider(context, controller);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ConsoleViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    { dispose: () => { controller.dispose(); provider.dispose(); } },

    // Keep the controller in step with settings edits without a reload.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('kopytko.console')) return;
      const next = readSettings();
      controller.updateSettings({
        maxLines: next.maxLines,
        reconnect: next.reconnect,
        logToFile: next.logToFile,
        outputDir: next.outputDir,
        historySize: next.historySize,
      });
    }),

    vscode.commands.registerCommand('kopytko.console.open', async () => {
      await vscode.commands.executeCommand('kopytko.console.focus');
    }),

    vscode.commands.registerCommand('kopytko.console.connect', async () => {
      await controller.connect();
      await vscode.commands.executeCommand('kopytko.console.focus');
    }),

    vscode.commands.registerCommand('kopytko.console.disconnect', () => {
      controller.disconnect();
    }),

    vscode.commands.registerCommand('kopytko.console.clear', () => {
      controller.clear();
      provider.notifyStateChange();
    }),

    vscode.commands.registerCommand('kopytko.console.saveOutput', async () => {
      const file = await controller.saveBuffer();
      if (!file) {
        vscode.window.showInformationMessage('Kopytko Console: nothing to save yet.');
        return;
      }
      vscode.window.showInformationMessage(`Kopytko Console: saved to ${file}`);
    }),

    vscode.commands.registerCommand('kopytko.console.selectPort', async () => {
      const picked = await vscode.window.showQuickPick(
        CONSOLE_PORTS.map((port) => ({
          label: String(port),
          description: CONSOLE_PORT_LABELS[port],
          port,
        })),
        { placeHolder: 'Select the Roku debug console port' },
      );
      if (!picked) return;
      controller.selectPort(picked.port);
    }),

    vscode.commands.registerCommand('kopytko.console.showCommands', async () => {
      const port: ConsolePort = controller.port;
      const picked = await vscode.window.showQuickPick(
        completeCommand(port, '').map((cmd) => ({
          label: cmd.args ? `${cmd.value} ${cmd.args}` : cmd.value,
          description: cmd.destructive ? `${cmd.description} (destructive)` : cmd.description,
          detail: cmd.source === 'device' ? 'Observed on-device; not in the published docs' : undefined,
          value: cmd.value,
        })),
        { placeHolder: `Port ${port} — ${CONSOLE_PORT_LABELS[port]}`, matchOnDescription: true },
      );
      if (!picked) return;
      const result = controller.send(picked.value);
      if (result === 'not-connected') {
        vscode.window.showWarningMessage('Kopytko Console: not connected — run Connect first.');
      } else if (result === 'needs-confirmation') {
        vscode.window.showWarningMessage(
          `Kopytko Console: "${picked.value}" is destructive — run it from the console input to confirm.`,
        );
      }
    }),
  );

  return controller;
}
