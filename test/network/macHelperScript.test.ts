import { expect } from 'chai';
import { buildMacHelperScript, HEARTBEAT_TIMEOUT_SEC } from '../../src/client/network/redirect/mac/macHelperScript';

const BASE = {
  rokuIp: '192.168.137.46',
  proxyPort: 8888,
  ports: [80],
  logPath: '/Users/dev/Library/Application Support/kopytko/helper.log',
  statusPath: '/Users/dev/Library/Application Support/kopytko/helper-status.txt',
  cmdFifoPath: '/Users/dev/Library/Application Support/kopytko/helper.cmd',
  heartbeatPath: '/Users/dev/Library/Application Support/kopytko/helper.heartbeat',
  pidPath: '/Users/dev/Library/Application Support/kopytko/helper.pid',
};

describe('network/redirect/mac/buildMacHelperScript', () => {
  it('embeds the initial rokuIp/proxyPort/ports as literal shell variables for the synchronous first apply', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain("INITIAL_ROKU_IP='192.168.137.46'");
    expect(script).to.contain('INITIAL_PROXY_PORT=8888');
    expect(script).to.contain("INITIAL_PORTS='80'");
    expect(script).to.contain('do_apply "$INITIAL_ROKU_IP" "$INITIAL_PROXY_PORT" "$INITIAL_PORTS"');
  });

  it('joins multiple ports into a single comma-separated INITIAL_PORTS value', () => {
    const script = buildMacHelperScript({ ...BASE, ports: [80, 443, 8060] });
    expect(script).to.contain("INITIAL_PORTS='80,443,8060'");
  });

  it("do_apply builds the same rdr rule shape as the one-shot path, from its runtime arguments (not baked-in values)", () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('rokuIp="$1"');
    expect(script).to.contain('proxyPort="$2"');
    expect(script).to.contain('portsCsv="$3"');
    expect(script).to.contain('rdr pass inet proto tcp from $rokuIp to any port $port -> 127.0.0.1 port $proxyPort');
    expect(script).to.contain('pfctl -a "$PF_ANCHOR" -f -');
    expect(script).to.contain('pfctl -e');
  });

  it('inserts the pf anchor reference using a shell variable (PF_ANCHOR), not a value baked in per-call', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain("PF_ANCHOR='kopytko-net'");
    expect(script).to.contain('pfctl -s Anchor 2>/dev/null | grep -q "$PF_ANCHOR"');
    expect(script).to.contain('rdr-anchor \\"" anchor "\\""');
  });

  it('runs the /etc/pf.conf anchor-registration (full ruleset reload) exactly once, before the watchdog is backgrounded — never inside do_apply', () => {
    // Regression test for a real incident: re-checking/re-inserting the
    // anchor reference on every apply could spuriously re-trigger a full
    // `pfctl -f -` reload of the main ruleset after our own revert, which
    // clobbered macOS Internet Sharing's NAT anchor and broke HTTPS for the
    // device until a reboot. See findings/network-inspector.md.
    const script = buildMacHelperScript(BASE);

    const ensureFnBody = script.slice(script.indexOf('ensure_anchor_referenced() {'), script.indexOf('do_apply() {'));
    expect(ensureFnBody).to.contain('pfctl -s Anchor');
    expect(ensureFnBody).to.contain('awk');
    expect(ensureFnBody).to.contain('pfctl -f -');

    const doApplyBody = script.slice(script.indexOf('do_apply() {'), script.indexOf('do_revert() {'));
    expect(doApplyBody).to.not.contain('pfctl -s Anchor');
    expect(doApplyBody).to.not.contain('awk');
    expect(doApplyBody).to.not.contain('ensure_anchor_referenced');
    // do_apply only ever touches its own anchor, never the main ruleset.
    expect(doApplyBody).to.contain('pfctl -a "$PF_ANCHOR" -f -');

    // Called exactly once in the whole script, in the synchronous top-level
    // flow, before the initial do_apply — and specifically NOT from inside
    // the FIFO command loop's "apply)" case.
    const allOccurrences = script.split('ensure_anchor_referenced').length - 1;
    expect(allOccurrences).to.equal(2); // the definition + exactly one call site
    const callSiteIdx = script.indexOf('ensure_anchor_referenced\n');
    const initialApplyIdx = script.indexOf('if ! do_apply "$INITIAL_ROKU_IP"');
    const fifoApplyCaseIdx = script.indexOf('apply) log \'Apply command received.\'');
    expect(callSiteIdx).to.be.greaterThan(-1);
    expect(callSiteIdx).to.be.lessThan(initialApplyIdx);
    expect(callSiteIdx).to.be.lessThan(fifoApplyCaseIdx); // runs before the watchdog loop even exists, definitely not inside it
  });

  it('rejects a rokuIp that is not dotted-quad shaped before touching pfctl, so garbage can never reach a root shell command', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('case "$rokuIp" in');
    expect(script).to.contain('[0-9]*.[0-9]*.[0-9]*.[0-9]*) : ;;');
    expect(script).to.contain("Rejected apply: invalid rokuIp");
  });

  it('rejects a non-numeric proxyPort before touching pfctl', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain("''|*[!0-9]*)");
    expect(script).to.contain('Rejected apply: invalid proxyPort');
  });

  it('rejects an empty or non-numeric individual port within the comma list', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain("Rejected apply: empty ports");
    expect(script).to.contain("Rejected apply: invalid port");
  });

  it('every rejection path writes status \'failed\' and returns without ever reaching pfctl', () => {
    const script = buildMacHelperScript(BASE);
    const doApplyBody = script.slice(script.indexOf('do_apply() {'), script.indexOf('do_revert() {'));
    const rejections = doApplyBody.split("write_status 'failed'").length - 1;
    expect(rejections).to.be.at.least(3); // rokuIp, proxyPort, ports(empty), port-in-list
    expect(doApplyBody.match(/return 1/g)?.length).to.equal(rejections);
  });

  it('embeds every configured path as a double-quoted shell variable', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain(`LOG_FILE="${BASE.logPath}"`);
    expect(script).to.contain(`STATUS_FILE="${BASE.statusPath}"`);
    expect(script).to.contain(`CMD_FIFO="${BASE.cmdFifoPath}"`);
    expect(script).to.contain(`HEARTBEAT_FILE="${BASE.heartbeatPath}"`);
    expect(script).to.contain(`PID_FILE="${BASE.pidPath}"`);
  });

  it("escapes embedded double quotes and dollar signs so a path can't break out of its shell string", () => {
    const script = buildMacHelperScript({ ...BASE, logPath: '/tmp/weird "$HOME" path/helper.log' });
    expect(script).to.contain('LOG_FILE="/tmp/weird \\"\\$HOME\\" path/helper.log"');
  });

  it("escapes an embedded single quote in the initial rokuIp so it can't break out of its literal", () => {
    const script = buildMacHelperScript({ ...BASE, rokuIp: "192.168.1.5'; rm -rf /" });
    expect(script).to.contain(`INITIAL_ROKU_IP='192.168.1.5'\\''; rm -rf /'`);
  });

  it('opens the FIFO read-write on an unused fd so the watchdog never blocks waiting for a writer', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('exec 3<>"$CMD_FIFO"');
    expect(script).to.contain('read -t 1 -r cmd rokuIp proxyPort portsCsv <&3');
  });

  it('stamps a fresh heartbeat baseline the moment the watchdog starts, before trusting the heartbeat file', () => {
    const script = buildMacHelperScript(BASE);
    const watchdogStart = script.indexOf('date +%s > "$HEARTBEAT_FILE"');
    const fifoOpen = script.indexOf('exec 3<>"$CMD_FIFO"');
    expect(watchdogStart).to.be.greaterThan(-1);
    expect(fifoOpen).to.be.greaterThan(-1);
    expect(watchdogStart).to.be.lessThan(fifoOpen);
  });

  it('self-terminates (tears down the redirect) on heartbeat-file silence', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain(`TIMEOUT_SEC=${HEARTBEAT_TIMEOUT_SEC}`);
    expect(script).to.contain('$((now - hb)) -gt "$TIMEOUT_SEC"');
    expect(script).to.contain('teardown_and_exit');
  });

  it('recognizes exactly apply/revert/stop — never eval\'s FIFO input', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('case "$cmd" in');
    expect(script).to.contain('stop)');
    expect(script).to.contain('revert)');
    expect(script).to.contain('apply)');
    expect(script).to.not.contain('eval');
  });

  it('revert flushes the anchor but does not exit the watchdog (stays alive for a later apply)', () => {
    const script = buildMacHelperScript(BASE);
    const doRevertBody = script.slice(script.indexOf('do_revert() {'), script.indexOf("write_status 'starting'"));
    expect(doRevertBody).to.contain('pfctl -a kopytko-net -F all');
    expect(doRevertBody).to.contain("write_status 'reverted'");
    expect(doRevertBody).to.not.contain('exit');
    expect(script).to.contain("revert) log 'Revert command received.'; do_revert ;;");
  });

  it('apply forwards the FIFO-supplied rokuIp/proxyPort/ports straight into do_apply, and can be re-triggered without exiting', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('apply) log \'Apply command received.\'; do_apply "$rokuIp" "$proxyPort" "$portsCsv" || true ;;');
  });

  it('only "stop" removes the FIFO and exits the watchdog', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain("stop) log 'Stop command received.'; teardown_and_exit ;;");
    const teardownBody = script.slice(script.indexOf('teardown_and_exit() {'), script.indexOf('(\n  # Fresh baseline'));
    expect(teardownBody).to.contain('do_revert');
    expect(teardownBody).to.contain("write_status 'stopped'");
    expect(teardownBody).to.contain('rm -f "$CMD_FIFO"');
    expect(teardownBody).to.contain('exit 0');
  });

  it('backgrounds the watchdog and exits the top-level script promptly after the initial apply (so the elevation call resolves quickly)', () => {
    const script = buildMacHelperScript(BASE);
    const backgroundIdx = script.indexOf(') </dev/null >>"$LOG_FILE" 2>&1 &');
    const exitIdx = script.lastIndexOf('exit 0');
    expect(backgroundIdx).to.be.greaterThan(-1);
    expect(exitIdx).to.be.greaterThan(backgroundIdx);
  });

  it('writes a status file distinguishing starting/ready/reverted/stopped/failed', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain("write_status 'starting'");
    expect(script).to.contain("write_status 'ready'");
    expect(script).to.contain("write_status 'reverted'");
    expect(script).to.contain("write_status 'stopped'");
    expect(script).to.contain("write_status 'failed'");
  });

  it('reports the initial apply failure via the status file instead of leaving the launcher to time out silently', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('if ! do_apply "$INITIAL_ROKU_IP" "$INITIAL_PROXY_PORT" "$INITIAL_PORTS"; then');
    expect(script).to.contain('exit 1');
  });
});
