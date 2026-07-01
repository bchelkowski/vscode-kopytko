import { EventEmitter } from 'events';
import type { Collector } from './collector';
import type { DiagnosticSample } from '../session/eventModel';
import { BeaconLogClient, type LogSocketFactory } from '../transport/beaconLogClient';
import { parseFwBeaconLine } from '../parsers/fwBeacon';

/**
 * Streams the port-8085 BrightScript log and emits a sample for each
 * `[beacon.signal]` framework beacon line. Unlike the other collectors this
 * is event-driven, not polled — `start()`/`stop()` open/close the underlying
 * log connection rather than an interval timer.
 *
 * Also re-emits `'rejected'` (payload: the device's rejection line) when the
 * device refuses the connection — this port only accepts one consumer at a
 * time, so it collides with anything else already reading it (most commonly
 * an active debug session's IO channel).
 */
export class FwBeaconCollector extends EventEmitter implements Collector {
  readonly type = 'fw-beacon' as const;
  private readonly client: BeaconLogClient;
  private lineListener?: (line: string) => void;
  private rejectedListener?: (line: string) => void;

  constructor(host: string, port: number, socketFactory?: LogSocketFactory) {
    super();
    this.client = new BeaconLogClient({ host, port, socketFactory });
  }

  start(): void {
    if (this.lineListener) return;
    this.lineListener = (line: string) => {
      const beacon = parseFwBeaconLine(line);
      if (!beacon) return;
      const sample: DiagnosticSample = {
        type: 'fw-beacon',
        wall: beacon.deviceWall,
        name: beacon.name,
        timeBaseMs: beacon.timeBaseMs,
      };
      this.emit('sample', sample);
    };
    this.rejectedListener = (line: string) => this.emit('rejected', line);
    this.client.on('line', this.lineListener);
    this.client.on('rejected', this.rejectedListener);
    this.client.start();
  }

  stop(): void {
    if (this.lineListener) {
      this.client.removeListener('line', this.lineListener);
      this.lineListener = undefined;
    }
    if (this.rejectedListener) {
      this.client.removeListener('rejected', this.rejectedListener);
      this.rejectedListener = undefined;
    }
    this.client.close();
  }
}
