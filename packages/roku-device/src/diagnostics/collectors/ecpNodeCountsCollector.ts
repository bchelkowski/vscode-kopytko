import { PollingCollector } from './collector';
import type { DiagnosticSample } from '../eventModel';
import type { EcpClient } from '../../ecp/ecpClient';
import { parseEcpSgNodes } from '../parsers/ecpSgNodes';

/** Polls ECP `/query/sgnodes/all` (port 8060, HTTP) for SceneGraph node counts. */
export class EcpNodeCountsCollector extends PollingCollector {
  readonly type = 'node-counts' as const;

  constructor(
    private readonly ecp: EcpClient,
    private readonly ip: string,
    private readonly ecpPort: number,
    intervalMs: number,
  ) {
    super(intervalMs);
  }

  protected async collect(): Promise<DiagnosticSample[]> {
    const xml = await this.ecp.querySgNodes(this.ip, this.ecpPort);
    const sample = parseEcpSgNodes(xml);
    if (!sample) return [];
    return [{
      type: 'node-counts',
      wall: Date.now(),
      totalCount: sample.totalCount,
      totalStaticBytes: sample.totalStaticBytes,
      types: sample.types,
    }];
  }
}
