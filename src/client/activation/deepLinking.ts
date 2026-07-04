import * as vscode from 'vscode';
import { DeepLinkingController } from '../deepLinking/deepLinkingController';
import { ParameterSetStore } from '../deepLinking/parameterSetStore';
import { DeepLinkingPanel } from '../deepLinking/views/deepLinkingPanel';
import type { DiscoveryServices } from './discovery';

export function registerDeepLinking(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): void {
  const store = new ParameterSetStore(context.workspaceState);
  const controller = new DeepLinkingController({
    deviceManager: services.deviceManager,
    ecp: services.ecp,
    store,
  });

  context.subscriptions.push(
    { dispose: () => { DeepLinkingPanel.instance?.panel.dispose(); } },

    vscode.commands.registerCommand('kopytko.deepLinking.open', () => {
      DeepLinkingPanel.createOrReveal(context, controller);
    }),
  );
}
