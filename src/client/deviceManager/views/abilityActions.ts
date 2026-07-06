import * as vscode from 'vscode';
import type { AbilitiesController } from '../abilitiesController';
import { PasswordPromptCancelled } from '../abilitiesController';
import type { AbilityAction } from '../webview/protocol';

/**
 * Executes a Device-view ability using native VS Code dialogs for every input
 * (file pickers, masked password boxes, confirm modals) — the ~300px sidebar
 * webview only hosts the trigger buttons.
 *
 * Returns `{ ok, message? }` for the webview's inline status line; user-facing
 * toasts are shown here as well. A cancelled dialog resolves as ok (silent).
 */
export async function runAbilityAction(
  action: AbilityAction,
  abilities: AbilitiesController,
): Promise<{ ok: boolean; message?: string }> {
  try {
    switch (action) {
      case 'deviceInfo': {
        const info = await abilities.queryDeviceInfo();
        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(info, null, 2),
          language: 'json',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
        return { ok: true };
      }

      case 'activeApp': {
        const app = await abilities.queryActiveApp();
        const label = app
          ? `${app.name}${app.id ? ` (id: ${app.id})` : ''}${app.version ? ` v${app.version}` : ''}`
          : 'No active app reported.';
        void vscode.window.showInformationMessage(`Active app: ${label}`);
        return { ok: true, message: label };
      }

      case 'screenshot': {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = await vscode.window.showSaveDialog({
          title: 'Save device screenshot',
          defaultUri: vscode.Uri.file(`screenshot-${stamp}.jpg`),
          filters: { 'JPEG image': ['jpg', 'jpeg'] },
        });
        if (!dest) return { ok: true };

        await abilities.takeScreenshot(dest.fsPath);
        await vscode.commands.executeCommand('vscode.open', dest);
        return { ok: true, message: 'Screenshot captured.' };
      }

      case 'checkUpdate': {
        await abilities.checkForUpdate();
        void vscode.window.showInformationMessage('Update check triggered — the result shows on the device (System Update screen).');
        return { ok: true, message: 'Update check triggered.' };
      }

      case 'reboot': {
        const confirmed = await vscode.window.showWarningMessage(
          'Reboot the Roku device?', { modal: true }, 'Reboot',
        );
        if (confirmed !== 'Reboot') return { ok: true };
        await abilities.reboot();
        void vscode.window.showInformationMessage('Device is rebooting.');
        return { ok: true, message: 'Rebooting…' };
      }

      case 'installChannel': {
        const picked = await vscode.window.showOpenDialog({
          title: 'Select channel zip to install',
          filters: { 'Channel archive': ['zip'] },
          canSelectMany: false,
        });
        if (!picked?.[0]) return { ok: true };
        await abilities.installChannel(picked[0].fsPath);
        void vscode.window.showInformationMessage('Channel installed.');
        return { ok: true, message: 'Channel installed.' };
      }

      case 'deleteChannel': {
        const confirmed = await vscode.window.showWarningMessage(
          'Delete the sideloaded dev channel from the device?', { modal: true }, 'Delete',
        );
        if (confirmed !== 'Delete') return { ok: true };
        await abilities.deleteChannel();
        void vscode.window.showInformationMessage('Dev channel deleted.');
        return { ok: true, message: 'Dev channel deleted.' };
      }

      case 'packageChannel': {
        const zip = await vscode.window.showOpenDialog({
          title: 'Select channel zip to install & package',
          filters: { 'Channel archive': ['zip'] },
          canSelectMany: false,
        });
        if (!zip?.[0]) return { ok: true };

        const appNameVersion = await vscode.window.showInputBox({
          title: 'App name/version for the package',
          placeHolder: 'MyApp/1.0',
          ignoreFocusOut: true,
        });
        if (!appNameVersion) return { ok: true };

        const signingPassword = await vscode.window.showInputBox({
          title: 'Signing password (from genkey)',
          password: true,
          ignoreFocusOut: true,
        });
        if (!signingPassword) return { ok: true };

        const dest = await vscode.window.showSaveDialog({
          title: 'Save signed package as',
          filters: { 'Roku package': ['pkg'] },
        });
        if (!dest) return { ok: true };

        await abilities.packageChannel(zip[0].fsPath, appNameVersion, signingPassword, dest.fsPath);
        void vscode.window.showInformationMessage(`Signed package saved: ${dest.fsPath}`);
        return { ok: true, message: 'Package created.' };
      }

      case 'rekey': {
        const pkg = await vscode.window.showOpenDialog({
          title: 'Select signed .pkg to rekey the device with',
          filters: { 'Roku package': ['pkg'] },
          canSelectMany: false,
        });
        if (!pkg?.[0]) return { ok: true };

        const signingPassword = await vscode.window.showInputBox({
          title: 'Signing password for the package',
          password: true,
          ignoreFocusOut: true,
        });
        if (!signingPassword) return { ok: true };

        await abilities.rekey(pkg[0].fsPath, signingPassword);
        void vscode.window.showInformationMessage('Device rekeyed.');
        return { ok: true, message: 'Device rekeyed.' };
      }
    }
  } catch (err) {
    if (err instanceof PasswordPromptCancelled) return { ok: true };
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`${actionLabel(action)} failed: ${message}`);
    return { ok: false, message };
  }
}

function actionLabel(action: AbilityAction): string {
  switch (action) {
    case 'deviceInfo': return 'Device info';
    case 'activeApp': return 'Active app';
    case 'screenshot': return 'Screenshot';
    case 'checkUpdate': return 'Update check';
    case 'reboot': return 'Reboot';
    case 'installChannel': return 'Install channel';
    case 'deleteChannel': return 'Delete channel';
    case 'packageChannel': return 'Package channel';
    case 'rekey': return 'Rekey';
  }
}
