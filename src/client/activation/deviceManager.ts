import * as vscode from 'vscode';
import { InstallerClient } from 'kopytko-roku-device';
import { AbilitiesController } from '../deviceManager/abilitiesController';
import { DeviceManagerController } from '../deviceManager/deviceManagerController';
import { RemoteModeService } from '../deviceManager/remoteModeService';
import { ScriptRunnerService } from '../deviceManager/scriptRunnerService';
import { ScriptStore, type DeviceScript } from '../deviceManager/scriptStore';
import { TextEntryStore } from '../deviceManager/textEntryStore';
import { DeviceManagerViewProvider, type DeviceManagerViewKind } from '../deviceManager/views/deviceManagerViewProvider';
import { ScriptEditorPanel } from '../deviceManager/views/scriptEditorPanel';
import type { DiscoveryServices } from './discovery';

export function registerDeviceManager(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): void {
  const entries = new TextEntryStore(context.globalState, context.secrets);
  const scripts = new ScriptStore(context.globalState);
  const controller = new DeviceManagerController({
    deviceManager: services.deviceManager,
    ecp: services.ecp,
    entries,
  });
  const abilities = new AbilitiesController({
    deviceManager: services.deviceManager,
    installer: new InstallerClient(services.ecp),
    credentials: services.credentials,
    promptPassword: async (device) => {
      const password = await vscode.window.showInputBox({
        title: `Developer password for ${device.friendlyName || device.ip}`,
        prompt: 'The web-admin password (user "rokudev") set when enabling developer mode.',
        password: true,
        ignoreFocusOut: true,
      });
      if (password !== undefined && password !== '') {
        const save = await vscode.window.showQuickPick(['Save for this device', 'Use once'], {
          title: 'Remember this password?',
        });
        if (save === 'Save for this device') {
          await services.credentials.setPassword(device.deviceId || device.serialNumber, password);
        }
      }
      return password || undefined;
    },
  });
  const runner = new ScriptRunnerService(services.deviceManager, services.ecp);
  const remoteMode = new RemoteModeService();

  const editorDeps = { controller, scripts, runner };
  const openScriptEditor = (script?: DeviceScript, imported?: { title: string; source: string }): void => {
    ScriptEditorPanel.open(context, editorDeps, script, imported);
  };

  const viewDeps = {
    controller, abilities, scripts, runner, remoteMode, openScriptEditor,
    recordPress: (key: string) => ScriptEditorPanel.recordRemotePress(key),
    recordText: (text: string) => ScriptEditorPanel.recordRemoteText(text),
  };
  const kinds: DeviceManagerViewKind[] = ['remote', 'scripts'];

  context.subscriptions.push(
    runner,
    remoteMode,
    { dispose: () => ScriptEditorPanel.disposeAll() },
    { dispose: () => { void controller.releaseAllHeldKeys(); } },

    ...kinds.map((kind) => vscode.window.registerWebviewViewProvider(
      DeviceManagerViewProvider.viewId(kind),
      new DeviceManagerViewProvider(kind, context, viewDeps),
    )),

    vscode.commands.registerCommand('kopytko.deviceManager.open', () => {
      void vscode.commands.executeCommand('kopytko.deviceManager.remote.focus');
    }),

    vscode.commands.registerCommand('kopytko.deviceManager.toggleRemoteMode', () => {
      void remoteMode.toggle();
    }),

    vscode.commands.registerCommand('kopytko.deviceManager.newScript', () => {
      openScriptEditor();
    }),

    // Keybinding target for remote-control mode (not in the command palette —
    // it is registered here but deliberately not declared in contributes.commands).
    vscode.commands.registerCommand('kopytko.deviceManager.pressKey', (args: { key?: string } | undefined) => {
      const key = args?.key;
      if (typeof key !== 'string' || key === '') return;
      ScriptEditorPanel.recordRemotePress(key);
      controller.pressKey(key).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Remote key ${key} failed: ${message}`);
      });
    }),
  );
}
