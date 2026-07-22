/**
 * Builds the `/bin/sh` script that implements a single-elevation macOS
 * traffic redirect: apply the same `pfctl` commands `redirectController.ts`
 * already uses for the one-shot path, then background a small watchdog that
 * stays alive as root for the rest of the capture session so `disable()`
 * never has to trigger a second `osascript … with administrator privileges`
 * dialog.
 *
 * `pf` state itself needs no live process — `pfctl -a kopytko-net -F all` is
 * a plain one-shot root command, runnable at any time by any root process.
 * This helper's only job is to avoid the second password prompt; it is not
 * required by the redirect mechanism the way Windows' WinDivert companion is
 * (see `redirect/windows/companionScript.ts`).
 *
 * Control channel is a POSIX FIFO carrying exactly one command (`stop`),
 * chosen over a Unix socket because `mkfifo` is guaranteed present on stock
 * macOS while `nc`/`socat` are not. The watchdog opens the FIFO read-write on
 * an unused fd (`exec 3<>"$CMD_FIFO"`) — opening it read-only would block
 * until a writer appears, which would stall the watchdog loop (and its
 * heartbeat check) indefinitely before the first `disable()` ever happens.
 *
 * Self-termination baseline: the watchdog stamps its own fresh heartbeat the
 * moment it starts, rather than trusting the timestamp Node wrote before
 * elevation — the admin-password dialog can sit open for longer than the
 * heartbeat timeout while the user types, which would otherwise make the
 * watchdog immediately think Node had gone silent and tear itself down.
 *
 * Pure string generation, no vscode/OS dependency — unit-tested directly.
 * The generated script is written to disk and launched elevated by
 * `macHelperSupervisor.ts`; it is never executed from this module.
 */

import { buildSetupCommands, buildTeardownCommands, type RedirectOptions } from '../redirectController';

export interface MacHelperScriptOptions {
  rokuIp: string;
  proxyPort: number;
  ports: number[];
  /** Where the helper appends structured log lines. */
  logPath: string;
  /** Where the helper writes its `starting`/`ready`/`failed`/`stopped` status. */
  statusPath: string;
  /** FIFO the watchdog reads `stop` commands from. */
  cmdFifoPath: string;
  /** Plain file Node stamps with the current epoch-seconds on a heartbeat interval. */
  heartbeatPath: string;
  /** Where the watchdog records its own PID — diagnostics only, never used to signal it. */
  pidPath: string;
}

/** Seconds of heartbeat-file silence from the extension host before the watchdog self-terminates. */
export const HEARTBEAT_TIMEOUT_SEC = 15;

export function buildMacHelperScript(o: MacHelperScriptOptions): string {
  const options: RedirectOptions = { rokuIp: o.rokuIp, proxyPort: o.proxyPort, ports: o.ports };
  const setupCommands = buildSetupCommands('darwin', options);
  const teardownCommands = buildTeardownCommands('darwin', options);

  return `#!/bin/sh
# Kopytko Network Inspector — macOS traffic-capture helper
# Generated. Do not edit by hand — regenerated fresh on every capture start.
#
# Applies the pf redirect, then backgrounds a watchdog that keeps running as
# root for the rest of the capture session so disable() never needs a second
# admin-password prompt. The watchdog self-terminates (reverting the redirect)
# on an explicit "stop" command or after ${HEARTBEAT_TIMEOUT_SEC}s of heartbeat
# silence from the extension host, so a crashed VS Code can never leave the
# redirect running unattended.
set -e

LOG_FILE="${shDoubleQuote(o.logPath)}"
STATUS_FILE="${shDoubleQuote(o.statusPath)}"
CMD_FIFO="${shDoubleQuote(o.cmdFifoPath)}"
HEARTBEAT_FILE="${shDoubleQuote(o.heartbeatPath)}"
PID_FILE="${shDoubleQuote(o.pidPath)}"
TIMEOUT_SEC=${HEARTBEAT_TIMEOUT_SEC}

write_status() {
  printf '%s' "$1" > "$STATUS_FILE"
  chmod 644 "$STATUS_FILE" 2>/dev/null || true
}

log() {
  printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE" 2>/dev/null || true
}

write_status 'starting'
log 'Kopytko Network Inspector helper starting.'

if ! (
  set -e
${setupCommands.map((c) => `  ${c}`).join('\n')}
); then
  write_status 'failed'
  log 'Setup failed.'
  exit 1
fi

log 'Setup complete.'

teardown_and_exit() {
${teardownCommands.map((c) => `  ${c}`).join('\n')}
  write_status 'stopped'
  rm -f "$CMD_FIFO"
  log 'Watchdog self-terminated.'
  exit 0
}

(
  # Fresh baseline: an admin-password dialog can sit open longer than
  # TIMEOUT_SEC while the user types, so trust "now" over whatever Node
  # stamped before elevation ran.
  date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true
  # Read-write (not read-only) so opening the FIFO never blocks waiting for a
  # writer — this shell is its own permanent writer too.
  exec 3<>"$CMD_FIFO"
  while :; do
    now=$(date +%s)
    hb=$(cat "$HEARTBEAT_FILE" 2>/dev/null || echo 0)
    if [ $((now - hb)) -gt "$TIMEOUT_SEC" ]; then
      log 'Heartbeat timeout - extension host appears to be gone. Tearing down redirect for safety.'
      teardown_and_exit
    fi
    if IFS= read -t 1 -r cmd <&3; then
      case "$cmd" in
        stop) log 'Stop command received.'; teardown_and_exit ;;
      esac
    fi
  done
) </dev/null >>"$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
write_status 'ready'
log 'Watchdog backgrounded, helper script exiting.'
exit 0
`;
}

/** Escapes a literal for embedding inside a double-quoted POSIX shell string. */
function shDoubleQuote(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}
