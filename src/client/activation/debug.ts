import * as vscode from 'vscode';
import { BrightScriptDebugAdapterFactory } from '../debug/debugAdapterFactory';
import { getAvailableEnvironments } from '../roku/kopytkorc';
import { DiscoveryServices } from './discovery';

export function registerDebug(
  context: vscode.ExtensionContext,
  services: DiscoveryServices,
): BrightScriptDebugAdapterFactory {
  const { deviceManager, credentials, workspaceRoot } = services;
  const debugFactory = new BrightScriptDebugAdapterFactory();

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('kopytko', debugFactory),
    vscode.debug.registerDebugConfigurationProvider('kopytko', {
      async resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        debugConfig: vscode.DebugConfiguration,
      ): Promise<vscode.DebugConfiguration | undefined> {
        const active = deviceManager.getActiveDevice();
        if (active) {
          if (!debugConfig['host']) debugConfig['host'] = active.ip;
          if (!debugConfig['password']) {
            const stored = await credentials.getPassword(active.deviceId || active.serialNumber);
            if (stored) debugConfig['password'] = stored;
          }
          if (!debugConfig['env']) {
            const availableEnvs = getAvailableEnvironments(workspaceRoot);
            const env = deviceManager.getEffectiveEnvironment(active.serialNumber, availableEnvs);
            if (env) debugConfig['env'] = env;
          }
        }
        if (!debugConfig['rootDir']) {
          debugConfig['rootDir'] = _folder?.uri.fsPath ?? '';
        }
        if (!debugConfig['sourceDir']) {
          debugConfig['sourceDir'] = vscode.workspace
            .getConfiguration('kopytko')
            .get<string>('imports.sourceDir', 'app');
        }
        return debugConfig;
      },
    }),
  );

  return debugFactory;
}
