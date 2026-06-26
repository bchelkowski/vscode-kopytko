import { stripConsoleResponse } from './consoleResponse';

/**
 * Device-wide memory snapshot, parsed from the `free` command (port 8080).
 *
 * This is the output of Linux `free(1)` — it reflects the whole device, not the
 * channel alone, but its trends still reveal channel-driven pressure. All values
 * are in KiB, as reported by the device.
 */
export interface FreeSample {
  total: number;
  used: number;
  free: number;
  shared: number;
  buffCache: number;
  available: number;
  swapTotal: number;
  swapUsed: number;
  swapFree: number;
}

const MEM_RE = /^Mem:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/im;
const SWAP_RE = /^Swap:\s+(\d+)\s+(\d+)\s+(\d+)/im;

/**
 * Parses a raw `free` response into a {@link FreeSample}. Returns `null` when no
 * `Mem:` line is present.
 */
export function parseFree(raw: string): FreeSample | null {
  const text = stripConsoleResponse(raw);

  const mem = MEM_RE.exec(text);
  if (!mem) return null;

  const swap = SWAP_RE.exec(text);

  return {
    total: Number(mem[1]),
    used: Number(mem[2]),
    free: Number(mem[3]),
    shared: Number(mem[4]),
    buffCache: Number(mem[5]),
    available: Number(mem[6]),
    swapTotal: swap ? Number(swap[1]) : 0,
    swapUsed: swap ? Number(swap[2]) : 0,
    swapFree: swap ? Number(swap[3]) : 0,
  };
}
