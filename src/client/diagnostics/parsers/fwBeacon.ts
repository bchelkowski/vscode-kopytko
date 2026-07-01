/** A single framework beacon marker, parsed from a port-8085 log line. */
export interface FwBeaconSample {
  name: string;
  /**
   * The beacon's reported numeric value, ms. `*Initiate` beacons report it as
   * `TimeBase(N ms)` (time since app launch); `*Complete` beacons report it
   * as `Duration(N ms)` (time since the matching Initiate) — confirmed live,
   * e.g. `VODStartInitiate ...> TimeBase(376 ms)` followed by
   * `VODStartComplete ...> Duration(201 ms)`. Both are just a labeled
   * millisecond count, so both are captured into this one field.
   */
  timeBaseMs: number;
  /**
   * Device-reported wall-clock time the line was written (epoch ms), derived
   * from the log's `MM-DD HH:MM:SS.mmm` prefix. The device log has no year,
   * so the year of `now` is assumed — correct except across a year boundary.
   * Using this instead of "time we received the line" matters because lines
   * buffered on the device before the log connection was established (or
   * before the beacon collector was turned on) otherwise all appear to have
   * happened "just now" instead of their real, earlier time.
   */
  deviceWall: number;
}

// e.g. `06-26 07:24:26.305 app  [beacon.signal] |AppLaunchInitiate ---------> TimeBase(0 ms)`
// or    `07-01 11:27:13.476 sdkl [beacon.signal] |AppLaunchChainComplete ----> Duration(333 ms)`
const LINE_RE =
  /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s.*\[beacon\.signal\]\s*\|\s*(\S+)\s*-+>\s*(?:TimeBase|Duration)\((\d+)\s*ms\)/;

/**
 * Parses a single line of port-8085 BrightScript log output for a
 * `[beacon.signal]` framework beacon marker. Returns `null` for any other
 * line (the vast majority — `print` output, warnings, translate misses, etc).
 *
 * @param now Reference time for resolving the log line's missing year.
 *   Defaults to `Date.now()`; overridable for tests.
 */
export function parseFwBeaconLine(line: string, now: number = Date.now()): FwBeaconSample | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const [, mm, dd, hh, min, sec, ms, name, timeBaseMs] = m;
  const year = new Date(now).getFullYear();
  const deviceWall = new Date(
    year, Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(sec), Number(ms),
  ).getTime();
  return { name, timeBaseMs: Number(timeBaseMs), deviceWall };
}
