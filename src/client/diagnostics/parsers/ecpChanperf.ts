import type { ChanperfSample } from './chanperf';

/**
 * Parses the ECP `/query/chanperf` response (port 8060, HTTP GET).
 *
 * Memory values in the ECP response are in **bytes** (not KiB).
 * CPU user/sys are **float percentages** (e.g. `0.0`, `1.5`).
 *
 * Example response:
 * ```xml
 * <chanperf>
 *   <plugin>
 *     <cpu-percent><user>0.0</user><sys>0.0</sys></cpu-percent>
 *     <memory>
 *       <used>42905600</used><anon>21086208</anon><file>21618688</file>
 *       <shared>200704</shared><swap>0</swap><limit>859832320</limit>
 *     </memory>
 *   </plugin>
 *   <status>OK</status>
 * </chanperf>
 * ```
 *
 * `<limit>` is the device-reported foreground memory ceiling for the channel
 * (bytes) — exceeding it gets the app terminated by the Roku OS. Not present
 * on the raw debug-console `chanperf` command, only ECP.
 */
export function parseEcpChanperf(xml: string): ChanperfSample | null {
  if (!xml.includes('<status>OK</status>')) return null;

  const num = (tag: string): number => {
    const m = xml.match(new RegExp(`<${tag}>([\\d.]+)</${tag}>`));
    return m ? parseFloat(m[1]) : NaN;
  };

  const used    = num('used');
  const anon    = num('anon');
  const file    = num('file');
  const shared  = num('shared');
  const swap    = num('swap');
  const limit   = num('limit');
  const cpuUser = num('user');
  const cpuSys  = num('sys');

  if (isNaN(used) || isNaN(cpuUser)) return null;

  const toKiB = (b: number) => Math.round((isNaN(b) ? 0 : b) / 1024);

  return {
    memKiB:    toKiB(used),
    anonKiB:   toKiB(anon),
    fileKiB:   toKiB(file),
    sharedKiB: toKiB(shared),
    swapKiB:   toKiB(swap),
    limitKiB:  isNaN(limit) ? undefined : toKiB(limit),
    cpuPct:    Math.round(cpuUser + (isNaN(cpuSys) ? 0 : cpuSys)),
    cpuUser:   Math.round(cpuUser),
    cpuSys:    Math.round(isNaN(cpuSys) ? 0 : cpuSys),
  };
}
