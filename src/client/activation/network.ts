import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NetworkController, type NetworkConfig } from '../network/networkController';
import { NetworkEditorPanel } from '../network/views/networkEditorPanel';
import { RedirectController, RedirectUnsupportedError } from '../network/redirect/redirectController';
import { createElevatedRunner } from '../network/redirect/elevate';
import { WindowsCompanionDriver } from '../network/redirect/windows/companionSupervisor';
import { resolveWinDivertDir } from '../network/redirect/windows/resolveWinDivertDir';
import { ruleSetFromConfig } from '../network/capture/rewrite/rules';
import { findGatewayIp } from '../network/discovery/gatewayIp';
import type { DiscoveryServices } from './discovery';

/**
 * Registers the Network Inspector editor-tab panel, controller, and commands.
 */
export function registerNetwork(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): NetworkController {
  const output = vscode.window.createOutputChannel('Kopytko Network Inspector');
  const log = (msg: string) => output.appendLine(msg);

  const scriptDir = vscode.Uri.joinPath(context.globalStorageUri, 'network').fsPath;

  // Real packet-level transparent redirect on Windows (WinDivert). The
  // extension bundles the official x64 WinDivert build (`resources/win/x64/`)
  // so this needs zero setup on the common case — `winDivertDir` is only an
  // escape hatch for a different build/version or a non-x64 architecture.
  // Undefined keeps the win32 branch `unsupported` — the proxy still runs,
  // but nothing is routed into it.
  const windowsDriver =
    process.platform === 'win32'
      ? new WindowsCompanionDriver({
          scriptDir,
          resolveWinDivertDir: () => {
            const configuredDir = vscode.workspace.getConfiguration('kopytko').get<string>('network.winDivertDir', '').trim();
            const bundledDir = vscode.Uri.joinPath(context.extensionUri, 'resources', 'win', 'x64').fsPath;
            const result = resolveWinDivertDir({
              configuredDir,
              arch: process.arch,
              bundledDir,
              hasWinDivertFiles: (dir) =>
                fs.existsSync(path.join(dir, 'WinDivert.dll')) && fs.existsSync(path.join(dir, 'WinDivert64.sys')),
            });
            if (!result.ok) throw new RedirectUnsupportedError(result.reason);
            return result.dir;
          },
          resolveGatewayIp: (rokuIp) => findGatewayIp(rokuIp),
          log,
        })
      : undefined;

  const redirect = new RedirectController(createElevatedRunner(scriptDir, log), process.platform, windowsDriver);

  const readConfig = (): NetworkConfig => {
    const cfg = vscode.workspace.getConfiguration('kopytko');
    return {
      proxyPort: cfg.get<number>('network.proxyPort', 8888),
      redirectPorts: cfg.get<number[]>('network.redirectPorts', [80]),
      maxEntries: cfg.get<number>('network.maxEntries', 5000),
      maxBufferBytes: cfg.get<number>('network.maxBufferBytes', 52428800),
      filterToActiveDevice: cfg.get<boolean>('network.filterToActiveDevice', true),
      maxBodyBytes: cfg.get<number>('network.maxBodyBytes', 262144),
      upstreamKeepAlive: cfg.get<boolean>('network.upstreamKeepAlive', true),
      rules: ruleSetFromConfig(
        cfg.get('network.rewriteRules'),
        cfg.get('network.upstreamSchemes'),
        cfg.get<string>('network.defaultUpstreamScheme', 'https'),
        cfg.get('network.mapLocalRules'),
        cfg.get('network.latencyRules'),
        cfg.get('network.headerRules'),
      ),
    };
  };

  const controller = new NetworkController({
    deviceManager: services.deviceManager,
    redirect,
    readConfig,
    log,
  });

  context.subscriptions.push(
    output,
    { dispose: () => { controller.dispose(); NetworkEditorPanel.instance?.dispose(); } },

    vscode.commands.registerCommand('kopytko.network.open', () => {
      NetworkEditorPanel.createOrReveal(context, controller);
    }),

    vscode.commands.registerCommand('kopytko.network.toggleCapture', async () => {
      NetworkEditorPanel.createOrReveal(context, controller);
      try {
        if (controller.isEnabled) await controller.disable();
        else await controller.enable();
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Kopytko Network Inspector: ${(err as Error).message}`,
        );
      }
    }),

    vscode.commands.registerCommand('kopytko.network.clear', () => {
      controller.clear();
    }),
  );

  return controller;
}
