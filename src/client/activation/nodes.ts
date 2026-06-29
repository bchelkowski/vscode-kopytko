import * as vscode from 'vscode';
import { NodeTreePanel } from '../nodes/nodeTreePanel';
import type { DiscoveryServices } from './discovery';

export function registerNodes(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): void {
  const deps = {
    deviceManager: services.deviceManager,
    ecp: services.ecp,
  };

  context.subscriptions.push(
    { dispose: () => { NodeTreePanel.instance?.panel.dispose(); } },

    vscode.commands.registerCommand('kopytko.nodes.open', () => {
      NodeTreePanel.createOrReveal(context, deps);
    }),
  );
}
