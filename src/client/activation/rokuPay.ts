import * as vscode from 'vscode';
import { RokuPayClient } from '../rokuPay/rokuPayClient';
import { RokuPayController } from '../rokuPay/rokuPayController';
import { RokuPayLogStore } from '../rokuPay/rokuPayLogStore';
import { RokuPayProfileStore } from '../rokuPay/rokuPayProfileStore';
import { RokuPayPanel } from '../rokuPay/views/rokuPayPanel';

/**
 * Roku Pay Web Services tool — cloud-API only, needs no Roku device and
 * therefore no DiscoveryServices.
 */
export function registerRokuPay(context: vscode.ExtensionContext): void {
  const controller = new RokuPayController({
    profiles: new RokuPayProfileStore(context.globalState, context.secrets),
    log: new RokuPayLogStore(context.globalState),
    client: new RokuPayClient(),
  });

  context.subscriptions.push(
    { dispose: () => { RokuPayPanel.instance?.panel.dispose(); } },

    vscode.commands.registerCommand('kopytko.rokuPay.open', () => {
      RokuPayPanel.createOrReveal(context, controller);
    }),
  );
}
