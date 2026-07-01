import { PollingCollector } from './collector';
import type { DiagnosticSample } from '../session/eventModel';
import type { EcpClient } from '../../roku/discovery/ecpClient';

/** Polls ECP `/query/app-state/<appId>` (port 8060, HTTP) for app foreground/background state. */
export class AppStateCollector extends PollingCollector {
  readonly type = 'app-state' as const;

  constructor(
    private readonly ecp: EcpClient,
    private readonly ip: string,
    private readonly ecpPort: number,
    private readonly appId: string,
    intervalMs: number,
  ) {
    super(intervalMs);
  }

  protected async collect(): Promise<DiagnosticSample[]> {
    const state = await this.ecp.queryAppState(this.ip, this.appId, this.ecpPort);
    return [{ type: 'app-state', wall: Date.now(), state }];
  }
}
