/**
 * Applies and reverts the OS-level transparent redirect that funnels the Roku's
 * outbound HTTP traffic into the capture proxy. All three platforms redirect
 * *all* of a device's port-80 traffic transparently by matching its source IP
 * at the packet level, so no hostname knowledge is ever needed.
 *  - **Linux**: a dedicated `KOPYTKO_NET` nat chain (flushed/deleted on revert).
 *  - **macOS**: a dedicated pf anchor `kopytko-net` (flushed on revert).
 *  - **Windows**: an elevated WinDivert companion process
 *    (`redirect/windows/`), since Windows has no `iptables`/`pf` equivalent —
 *    `netsh portproxy` only catches traffic already addressed to this
 *    machine, not traffic merely transiting it as a NAT gateway. Requires
 *    `kopytko.network.winDivertDir` to be configured; without it the proxy
 *    still runs and reports `unsupported`.
 *
 * Rules are exactly scoped so teardown never touches the user's own firewall
 * config, and teardown is idempotent + safe to call after a crash.
 */

export interface RedirectOptions {
  rokuIp: string;
  proxyPort: number;
  /** Device-side ports to redirect (default `[80]`). */
  ports: number[];
}

/** Runs a batch of shell commands with elevation. Injectable for tests. */
export type ElevatedRunner = (label: string, commands: string[]) => Promise<void>;

/**
 * Windows equivalent of `ElevatedRunner`, but not the same shape: unlike the
 * one-shot Linux/macOS command batches, Windows real transparent redirect
 * (WinDivert, see `redirect/windows/`) is a supervised persistent process
 * with its own elevation + IPC lifecycle. Injectable for tests; the real
 * implementation is `redirect/windows/companionSupervisor.ts`.
 */
export interface WindowsRedirectDriver {
  enable(options: RedirectOptions): Promise<void>;
  disable(): Promise<void>;
}

export class RedirectUnsupportedError extends Error {}

const PF_ANCHOR = 'kopytko-net';
const IPT_CHAIN = 'KOPYTKO_NET';

export class RedirectController {
  private applied = false;
  private appliedPlatform: NodeJS.Platform | null = null;
  private appliedOptions: RedirectOptions | null = null;

  constructor(
    private readonly runElevated: ElevatedRunner,
    private readonly platform: NodeJS.Platform = process.platform,
    /** Real Windows redirect, when available. Undefined keeps win32 `unsupported` (the manual hosts-file flow). */
    private readonly windowsDriver?: WindowsRedirectDriver,
  ) {}

  get isApplied(): boolean {
    return this.applied;
  }

  /** The platform this controller targets. */
  get targetPlatform(): NodeJS.Platform {
    return this.platform;
  }

  /** Applies the redirect. Throws `RedirectUnsupportedError` on Windows (and any other unsupported platform). */
  async enable(options: RedirectOptions): Promise<void> {
    if (this.applied) await this.disable();

    if (this.platform === 'win32') {
      if (!this.windowsDriver) {
        throw new RedirectUnsupportedError(
          'No WinDivert redirect driver is configured for this platform. Set ' +
            '"kopytko.network.winDivertDir" to enable traffic capture on Windows. The proxy is ' +
            'still listening; you could route the device to it manually if you control its network path.',
        );
      }
      await this.windowsDriver.enable(options);
      this.applied = true;
      this.appliedPlatform = this.platform;
      this.appliedOptions = options;
      return;
    }

    const commands = buildSetupCommands(this.platform, options);
    if (commands.length === 0) {
      throw new RedirectUnsupportedError(`Traffic redirect is not supported on ${this.platform}.`);
    }

    await this.runElevated('Kopytko Network Inspector — enable traffic capture', commands);
    this.applied = true;
    this.appliedPlatform = this.platform;
    this.appliedOptions = options;
  }

  /** Reverts the redirect. Idempotent and safe after a crash. */
  async disable(): Promise<void> {
    if (this.appliedPlatform === 'win32' && this.windowsDriver) {
      try {
        await this.windowsDriver.disable();
      } finally {
        this.applied = false;
        this.appliedPlatform = null;
        this.appliedOptions = null;
      }
      return;
    }

    if (!this.appliedPlatform || !this.appliedOptions) {
      this.applied = false;
      return;
    }
    const commands = buildTeardownCommands(this.appliedPlatform, this.appliedOptions);
    try {
      if (commands.length > 0) {
        await this.runElevated('Kopytko Network Inspector — stop traffic capture', commands);
      }
    } finally {
      this.applied = false;
      this.appliedPlatform = null;
      this.appliedOptions = null;
    }
  }
}

// ── command generation (pure — unit tested) ──────────────────────────────────

export function buildSetupCommands(platform: NodeJS.Platform, o: RedirectOptions): string[] {
  if (platform === 'linux') return buildLinuxSetup(o);
  if (platform === 'darwin') return buildMacSetup(o);
  return [];
}

export function buildTeardownCommands(platform: NodeJS.Platform, o: RedirectOptions): string[] {
  if (platform === 'linux') return buildLinuxTeardown(o);
  if (platform === 'darwin') return buildMacTeardown(o);
  return [];
}

function buildLinuxSetup(o: RedirectOptions): string[] {
  const cmds = [
    'sysctl -w net.ipv4.ip_forward=1',
    // Idempotent: recreate the dedicated chain from scratch.
    `iptables -t nat -N ${IPT_CHAIN} 2>/dev/null || iptables -t nat -F ${IPT_CHAIN}`,
  ];
  for (const port of o.ports) {
    cmds.push(
      `iptables -t nat -A ${IPT_CHAIN} -s ${o.rokuIp} -p tcp --dport ${port} -j REDIRECT --to-ports ${o.proxyPort}`,
    );
  }
  // Jump into our chain from PREROUTING only once.
  cmds.push(
    `iptables -t nat -C PREROUTING -s ${o.rokuIp} -p tcp -j ${IPT_CHAIN} 2>/dev/null || ` +
      `iptables -t nat -A PREROUTING -s ${o.rokuIp} -p tcp -j ${IPT_CHAIN}`,
  );
  return cmds;
}

function buildLinuxTeardown(o: RedirectOptions): string[] {
  return [
    `iptables -t nat -D PREROUTING -s ${o.rokuIp} -p tcp -j ${IPT_CHAIN} 2>/dev/null || true`,
    `iptables -t nat -F ${IPT_CHAIN} 2>/dev/null || true`,
    `iptables -t nat -X ${IPT_CHAIN} 2>/dev/null || true`,
  ];
}

function buildMacSetup(o: RedirectOptions): string[] {
  // No `on <iface>`: rdr without an interface matches on all interfaces, so we
  // don't have to guess the Internet Sharing bridge name (bridge100/101/…).
  const rdrLines = o.ports
    .map((port) => `rdr pass inet proto tcp from ${o.rokuIp} to any port ${port} -> 127.0.0.1 port ${o.proxyPort}`)
    .join('\\n');
  // Reference our anchor from the main ruleset. The reference MUST sit among the
  // translation (rdr) anchors — appending it after the filter anchors makes
  // `pfctl -f` reject the whole file with an ordering error. `awk` inserts it
  // right after the first existing rdr-anchor line, preserving order.
  const insertAnchor =
    `awk '1; /^rdr-anchor/ && !x {print "rdr-anchor \\"${PF_ANCHOR}\\""; x=1}' /etc/pf.conf | pfctl -f -`;
  return [
    `pfctl -s Anchor 2>/dev/null | grep -q '${PF_ANCHOR}' || { ${insertAnchor}; }`,
    `printf '${rdrLines}\\n' | pfctl -a ${PF_ANCHOR} -f -`,
    'pfctl -e 2>/dev/null || true',
  ];
}

function buildMacTeardown(_o: RedirectOptions): string[] {
  return [`pfctl -a ${PF_ANCHOR} -F all 2>/dev/null || true`];
}
