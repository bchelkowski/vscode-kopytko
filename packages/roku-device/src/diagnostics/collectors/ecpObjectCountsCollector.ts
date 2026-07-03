import { PollingCollector } from './collector';
import type { DiagnosticSample } from '../eventModel';
import type { EcpClient } from '../../ecp/ecpClient';
import { parseEcpAppObjectCounts } from '../parsers/ecpAppObjectCounts';

/** Polls ECP `/query/app-object-counts/<appId>` (port 8060, HTTP) for BrightScript object counts. */
export class EcpObjectCountsCollector extends PollingCollector {
  readonly type = 'object-counts' as const;

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
    const xml = await this.ecp.queryAppObjectCounts(this.ip, this.appId, this.ecpPort);
    const sample = parseEcpAppObjectCounts(xml);
    if (!sample) return [];
    return [{
      type: 'object-counts',
      wall: Date.now(),
      totalCount: sample.totalCount,
      totalPhysicalBytes: sample.totalPhysicalBytes,
      totalLogicalBytes: sample.totalLogicalBytes,
      types: sample.types,
    }];
  }
}
