import { expect } from 'chai';
import { buildWindowsCompanionScript, HEARTBEAT_TIMEOUT_SEC } from '../../src/client/network/redirect/windows/companionScript';

const BASE = {
  winDivertDllPath: 'C:\\Program Files\\Kopytko\\windivert\\WinDivert.dll',
  rokuIp: '192.168.137.46',
  proxyPort: 8888,
  ports: [80, 443],
  gatewayIp: '192.168.137.1',
  pipeName: 'kopytko-network-abc123',
  token: 'super-secret-token',
  logPath: 'C:\\Users\\dev\\AppData\\companion.log',
  statusPath: 'C:\\Users\\dev\\AppData\\companion-status.json',
};

describe('network/redirect/windows/buildWindowsCompanionScript', () => {
  it('embeds every configured parameter as a PowerShell variable', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain("$winDivertDllPath = 'C:\\Program Files\\Kopytko\\windivert\\WinDivert.dll'");
    expect(script).to.contain("$rokuIp = '192.168.137.46'");
    expect(script).to.contain('$proxyPort = 8888');
    expect(script).to.contain('$ports = @(80,443)');
    expect(script).to.contain("$gatewayIp = '192.168.137.1'");
    expect(script).to.contain("$pipeName = 'kopytko-network-abc123'");
    expect(script).to.contain("$token = 'super-secret-token'");
  });

  it("doubles embedded single quotes so a path can't break out of its PowerShell literal", () => {
    const script = buildWindowsCompanionScript({ ...BASE, winDivertDllPath: "C:\\Users\\Bob's PC\\WinDivert.dll" });
    expect(script).to.contain("$winDivertDllPath = 'C:\\Users\\Bob''s PC\\WinDivert.dll'");
  });

  it('builds a two-handle WinDivert architecture: NETWORK_FORWARD capture + NETWORK loopback bridge + a send-only injector', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain('LAYER_NETWORK_FORWARD, 0, 0);');
    expect(script).to.contain('WinDivertOpen(filterB, LAYER_NETWORK, 0, 0);');
    // Injection-only handle must never match real traffic — a broader filter
    // was found (live, against a real device) to steal packets HandleB needed.
    expect(script).to.contain('WinDivertOpen("false", LAYER_NETWORK, 0, FLAG_SEND_ONLY);');
  });

  it('resolves loopback and ICS interface indices dynamically rather than hardcoding them', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain("Get-NetIPAddress -IPAddress '127.0.0.1'");
    expect(script).to.contain('Get-NetIPAddress -IPAddress $gatewayIp');
    expect(script).to.contain('if (-not $loopbackIfIdx -or -not $icsIfIdx)');
  });

  it('calls WinDivertHelperCalcChecksums before every send (silent-drop prevention)', () => {
    const script = buildWindowsCompanionScript(BASE);
    // Only the two actual call sites (not the P/Invoke declaration) — each
    // one immediately precedes the WinDivertSend it protects.
    const calls = script.match(/WinDivertHelperCalcChecksums\(packetBuf/g) ?? [];
    const sends = script.match(/WinDivertSend\(Handle/g) ?? [];
    expect(calls.length).to.be.at.least(2);
    expect(calls.length).to.equal(sends.length);
  });

  it('scopes the request-capture filter to the device IP and every configured port, resolved at runtime not baked into the script', () => {
    const script = buildWindowsCompanionScript({ ...BASE, ports: [80, 443, 8060] });
    // Ports are runtime values (Companion.Run's `ports` parameter), not
    // string-baked into the C# source — the filter string is built dynamically.
    expect(script).to.contain('"ip.SrcAddr == " + rokuIp + " and " + portFilter');
    expect(script).to.contain('Array.ConvertAll(ports, p => "tcp.DstPort == " + p)');
    // The actual port numbers only appear where PowerShell passes them in.
    expect(script).to.contain('$ports = @(80,443,8060)');
  });

  it('lowers the named pipe mandatory integrity label so a non-elevated client (the extension host) can connect', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain('S:(ML;;;;;LW)');
  });

  it('requires a token before honoring any pipe command', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain('if (authLine != token)');
  });

  it('self-terminates on extension-host heartbeat silence, independent of process-crash cleanup', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain(`public const int HEARTBEAT_TIMEOUT_SEC = ${HEARTBEAT_TIMEOUT_SEC};`);
    expect(script).to.contain('Heartbeat timeout');
    expect(script).to.contain(`for ${HEARTBEAT_TIMEOUT_SEC} seconds`);
  });

  it('sweeps idle NAT table entries rather than growing unbounded', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain('NAT_IDLE_TIMEOUT_SEC');
    expect(script).to.contain('NatTable.TryRemove');
  });

  it('writes a status file the supervisor polls for readiness, distinguishing starting/ready/failed', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain('WriteStatus("ready"');
    expect(script).to.contain('WriteStatus("failed"');
    expect(script).to.contain("Write-CompanionStatus 'starting' ''");
  });

  it('tears down every WinDivert handle on shutdown, restoring normal networking', () => {
    const script = buildWindowsCompanionScript(BASE);
    expect(script).to.contain('static void Shutdown()');
    expect(script).to.contain('WinDivertApi.WinDivertClose(HandleA);');
    expect(script).to.contain('WinDivertApi.WinDivertClose(HandleB);');
    expect(script).to.contain('WinDivertApi.WinDivertClose(HandleInject);');
  });
});
