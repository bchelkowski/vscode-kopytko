import { PollingCollector } from './collector';
import type { DiagnosticSample } from '../eventModel';
import type { EcpClient } from '../../ecp/ecpClient';
import { parseEcpChanperf } from '../parsers/ecpChanperf';

/** Polls ECP `/query/chanperf` (port 8060, HTTP) for per-channel CPU + memory. */
export class EcpChanperfCollector extends PollingCollector {
  readonly type = 'mem-cpu' as const;

  constructor(
    private readonly ecp: EcpClient,
    private readonly ip: string,
    private readonly ecpPort: number,
    intervalMs: number,
  ) {
    super(intervalMs);
  }

  protected async collect(): Promise<DiagnosticSample[]> {
    const xml = await this.ecp.queryChanperf(this.ip, this.ecpPort);
    const sample = parseEcpChanperf(xml);
    if (!sample) return [];
    return [{ type: 'mem-cpu', wall: Date.now(), ...sample }];
  }
}
