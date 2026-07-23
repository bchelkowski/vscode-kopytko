/**
 * Builds the `/bin/sh` script that implements a single-elevation macOS
 * traffic redirect: apply the same `pfctl` rules `redirectController.ts`
 * already uses for the one-shot path, then background a small watchdog that
 * stays alive as root for the rest of the VS Code session — across every
 * capture on/off toggle *and* every switch of active device or redirect
 * ports — so at most one launch ever needs an admin-password prompt.
 *
 * `pf` state itself needs no live process — `pfctl -a kopytko-net -F all` is
 * a plain one-shot root command, runnable at any time by any root process.
 * This helper's only job is to avoid repeated password prompts; it is not
 * required by the redirect mechanism the way Windows' WinDivert companion is
 * (see `redirect/windows/companionScript.ts`).
 *
 * Control channel is a POSIX FIFO carrying three commands — `apply <rokuIp>
 * <proxyPort> <ports>` (re-runs setup, possibly for a *different* device or
 * ports than the last apply), `revert` (flushes the anchor but keeps the
 * watchdog alive for a later `apply`), and `stop` (flushes and exits) —
 * chosen over a Unix socket because `mkfifo` is guaranteed present on stock
 * macOS while `nc`/`socat` are not. Because `apply`'s rokuIp/proxyPort/ports
 * are read from the FIFO at *runtime* rather than baked into the script at
 * generation time, `do_apply` validates their shape (dotted-quad IPv4,
 * digits-only ports) before ever handing them to `pfctl`/`awk` as root —
 * this is defense-in-depth, not primary validation (the TypeScript side's
 * `RedirectOptions` are already well-typed), but this code runs privileged
 * and the FIFO is still a local attack surface worth being careful about.
 *
 * The watchdog opens the FIFO read-write on an unused fd
 * (`exec 3<>"$CMD_FIFO"`) — opening it read-only would block until a writer
 * appears, which would stall the watchdog loop (and its heartbeat check)
 * indefinitely before the first command is ever sent.
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

import { PF_ANCHOR, buildTeardownCommands } from '../redirectController';

export interface MacHelperScriptOptions {
  /** Redirect target for the very first `apply`, run synchronously before the watchdog is even backgrounded. Later `apply` commands over the FIFO can target a different device/ports without a new elevated launch. */
  rokuIp: string;
  proxyPort: number;
  ports: number[];
  /** Where the helper appends structured log lines. */
  logPath: string;
  /** Where the helper writes its `starting`/`ready`/`reverted`/`stopped`/`failed` status. */
  statusPath: string;
  /** FIFO the watchdog reads `apply`/`revert`/`stop` commands from. */
  cmdFifoPath: string;
  /** Plain file Node stamps with the current epoch-seconds on a heartbeat interval, for as long as the helper is meant to stay alive. */
  heartbeatPath: string;
  /** Where the watchdog records its own PID — diagnostics only, never used to signal it. */
  pidPath: string;
}

/** Seconds of heartbeat-file silence from the extension host before the watchdog self-terminates. */
export const HEARTBEAT_TIMEOUT_SEC = 15;

export function buildMacHelperScript(o: MacHelperScriptOptions): string {
  // do_revert() doesn't depend on rokuIp/proxyPort/ports at all (it just
  // flushes the whole anchor), so it's the one place still safe to generate
  // once from the TypeScript side, matching the one-shot path exactly.
  const teardownCommands = buildTeardownCommands('darwin', { rokuIp: o.rokuIp, proxyPort: o.proxyPort, ports: o.ports });

  return `#!/bin/sh
# Kopytko Network Inspector — macOS traffic-capture helper
# Generated. Do not edit by hand — regenerated fresh on every elevated launch.
#
# Applies the pf redirect, then backgrounds a watchdog that keeps running as
# root for the rest of the VS Code session — across every capture toggle and
# every device/port switch — listening for "apply"/"revert"/"stop" so none of
# that ever needs a second admin-password prompt. The watchdog reverts and
# exits on an explicit "stop" or after ${HEARTBEAT_TIMEOUT_SEC}s of heartbeat
# silence from the extension host, so a crashed VS Code can never leave the
# redirect (or the helper itself) running unattended.
set -e

LOG_FILE="${shDoubleQuote(o.logPath)}"
STATUS_FILE="${shDoubleQuote(o.statusPath)}"
CMD_FIFO="${shDoubleQuote(o.cmdFifoPath)}"
HEARTBEAT_FILE="${shDoubleQuote(o.heartbeatPath)}"
PID_FILE="${shDoubleQuote(o.pidPath)}"
TIMEOUT_SEC=${HEARTBEAT_TIMEOUT_SEC}
PF_ANCHOR='${shSingleQuote(PF_ANCHOR)}'
INITIAL_ROKU_IP='${shSingleQuote(o.rokuIp)}'
INITIAL_PROXY_PORT=${o.proxyPort}
INITIAL_PORTS='${shSingleQuote(o.ports.join(','))}'

write_status() {
  printf '%s' "$1" > "$STATUS_FILE"
  chmod 644 "$STATUS_FILE" 2>/dev/null || true
}

log() {
  printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE" 2>/dev/null || true
}

# $1=rokuIp $2=proxyPort $3=ports (comma-separated). Re-runnable for a
# different device/ports than the last call — validates its inputs before
# ever handing them to pfctl/awk as root, since (unlike the rest of this
# script) these three values arrive at runtime over the FIFO, not baked in
# by the TypeScript side at generation time.
do_apply() {
  rokuIp="$1"
  proxyPort="$2"
  portsCsv="$3"

  case "$rokuIp" in
    [0-9]*.[0-9]*.[0-9]*.[0-9]*) : ;;
    *)
      write_status 'failed'
      log "Rejected apply: invalid rokuIp '$rokuIp'"
      return 1
      ;;
  esac
  case "$proxyPort" in
    ''|*[!0-9]*)
      write_status 'failed'
      log "Rejected apply: invalid proxyPort '$proxyPort'"
      return 1
      ;;
  esac
  if [ -z "$portsCsv" ]; then
    write_status 'failed'
    log 'Rejected apply: empty ports'
    return 1
  fi

  rdrLines=""
  oldIFS="$IFS"
  IFS=,
  for port in $portsCsv; do
    case "$port" in
      ''|*[!0-9]*)
        IFS="$oldIFS"
        write_status 'failed'
        log "Rejected apply: invalid port '$port' in '$portsCsv'"
        return 1
        ;;
    esac
    rdrLines="\${rdrLines}rdr pass inet proto tcp from $rokuIp to any port $port -> 127.0.0.1 port $proxyPort
"
  done
  IFS="$oldIFS"

  if ! (
    set -e
    pfctl -s Anchor 2>/dev/null | grep -q "$PF_ANCHOR" || {
      awk -v anchor="$PF_ANCHOR" '1; /^rdr-anchor/ && !x {print "rdr-anchor \\"" anchor "\\""; x=1}' /etc/pf.conf | pfctl -f -
    }
    printf '%s' "$rdrLines" | pfctl -a "$PF_ANCHOR" -f -
    pfctl -e 2>/dev/null || true
  ); then
    write_status 'failed'
    log 'Apply failed.'
    return 1
  fi
  write_status 'ready'
  log "Redirect applied ($rokuIp -> proxy :$proxyPort, ports: $portsCsv)"
  return 0
}

do_revert() {
${teardownCommands.map((c) => `  ${c}`).join('\n')}
  write_status 'reverted'
  log 'Redirect reverted.'
}

write_status 'starting'
log 'Kopytko Network Inspector helper starting.'

if ! do_apply "$INITIAL_ROKU_IP" "$INITIAL_PROXY_PORT" "$INITIAL_PORTS"; then
  exit 1
fi

teardown_and_exit() {
  do_revert
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
      log 'Heartbeat timeout - extension host appears to be gone. Tearing down for safety.'
      teardown_and_exit
    fi
    if read -t 1 -r cmd rokuIp proxyPort portsCsv <&3; then
      case "$cmd" in
        stop) log 'Stop command received.'; teardown_and_exit ;;
        revert) log 'Revert command received.'; do_revert ;;
        apply) log 'Apply command received.'; do_apply "$rokuIp" "$proxyPort" "$portsCsv" || true ;;
      esac
    fi
  done
) </dev/null >>"$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
log 'Watchdog backgrounded, helper script exiting.'
exit 0
`;
}

/** Escapes a literal for embedding inside a double-quoted POSIX shell string. */
function shDoubleQuote(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

/** Escapes a literal for embedding inside a single-quoted POSIX shell string (the standard `'\''` trick). */
function shSingleQuote(s: string): string {
  return s.replace(/'/g, `'\\''`);
}
