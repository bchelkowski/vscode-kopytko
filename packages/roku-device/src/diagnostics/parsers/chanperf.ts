import { stripConsoleResponse } from './consoleResponse';

/**
 * Per-channel CPU and memory usage, parsed from the `chanperf` command on the
 * SceneGraph debug server (port 8080).
 *
 * All memory values are in KiB; CPU values are whole-number percentages.
 */
export interface ChanperfSample {
  /** Total resident memory of the channel, KiB. */
  memKiB: number;
  /** Anonymous (heap) memory, KiB. */
  anonKiB: number;
  /** File-backed (code/mapped) memory, KiB. */
  fileKiB: number;
  /** Shared memory, KiB. */
  sharedKiB: number;
  /** Swapped memory, KiB. */
  swapKiB: number;
  /** Foreground memory limit for the channel, KiB — undefined when the device doesn't report it (raw debug-console `chanperf` has no limit field). */
  limitKiB?: number;
  /** Raw Linux `/proc`-style CPU/process status text (Roku OS 15.2+, ECP only — undefined on older firmware or the debug-console `chanperf` command). */
  procStat?: string;
  /** Total CPU usage of the channel, percent. */
  cpuPct: number;
  /** User-space CPU usage, percent. */
  cpuUser: number;
  /** System (kernel) CPU usage, percent. */
  cpuSys: number;
}

const MEM_RE =
  /mem=(\d+)KiB\{anon=(\d+),\s*file=(\d+),\s*shared=(\d+),\s*swap=(\d+)\}/i;
const CPU_RE = /%cpu=(\d+)\{user=(\d+),\s*sys=(\d+)\}/i;

/**
 * Parses a raw `chanperf` response into a {@link ChanperfSample}.
 *
 * Example payload (after banner/prompt stripping):
 * `channel: mem=53920KiB{anon=31968,file=21756,shared=196,swap=0},%cpu=0{user=0,sys=0}`
 *
 * Accepts either the raw device response (with banner/prompt) or an already
 * cleaned payload. Returns `null` when the line does not match (e.g. the channel
 * is not running).
 */
export function parseChanperf(raw: string): ChanperfSample | null {
  const text = stripConsoleResponse(raw);

  const mem = MEM_RE.exec(text);
  const cpu = CPU_RE.exec(text);
  if (!mem || !cpu) return null;

  return {
    memKiB: Number(mem[1]),
    anonKiB: Number(mem[2]),
    fileKiB: Number(mem[3]),
    sharedKiB: Number(mem[4]),
    swapKiB: Number(mem[5]),
    cpuPct: Number(cpu[1]),
    cpuUser: Number(cpu[2]),
    cpuSys: Number(cpu[3]),
  };
}
