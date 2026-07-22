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
  it('embeds the exact same pf setup/teardown commands the one-shot ElevatedRunner path uses', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('kopytko-net');
    expect(script).to.contain('rdr pass');
    expect(script).to.contain('127.0.0.1 port 8888');
    expect(script).to.contain('pfctl -e');
    expect(script).to.contain('pfctl -a kopytko-net -F all');
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

  it('opens the FIFO read-write on an unused fd so the watchdog never blocks waiting for a writer', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('exec 3<>"$CMD_FIFO"');
    expect(script).to.contain('read -t 1 -r cmd <&3');
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

  it('only recognizes the "stop" command — never eval\'s FIFO input', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('case "$cmd" in');
    expect(script).to.contain('stop)');
    expect(script).to.not.contain('eval');
  });

  it('backgrounds the watchdog and exits the top-level script promptly (so the elevation call resolves quickly)', () => {
    const script = buildMacHelperScript(BASE);
    const backgroundIdx = script.indexOf(') </dev/null >>"$LOG_FILE" 2>&1 &');
    const exitIdx = script.lastIndexOf('exit 0');
    expect(backgroundIdx).to.be.greaterThan(-1);
    expect(exitIdx).to.be.greaterThan(backgroundIdx);
  });

  it('writes a status file distinguishing starting/ready/failed/stopped', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain("write_status 'starting'");
    expect(script).to.contain("write_status 'ready'");
    expect(script).to.contain("write_status 'failed'");
    expect(script).to.contain("write_status 'stopped'");
  });

  it('reports setup failure via the status file instead of leaving the launcher to time out silently', () => {
    const script = buildMacHelperScript(BASE);
    expect(script).to.contain('if ! (');
    expect(script).to.contain("write_status 'failed'");
  });
});
