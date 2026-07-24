/**
 * Applies and reverts the OS-level transparent redirect that funnels the Roku's
 * outbound HTTP traffic into the capture proxy. All three platforms redirect
 * *all* of a device's port-80 traffic transparently by matching its source IP
 * at the packet level, so no hostname knowledge is ever needed.
 *  - **Linux**: a dedicated `KOPYTKO_NET` nat chain (flushed/deleted on revert).
 *  - **macOS**: a dedicated pf anchor nested under `com.apple/` (see
 *    `PF_ANCHOR`) so the default `/etc/pf.conf` wildcard evaluates it without
 *    any main-ruleset reload; applied and reverted by a persistent,
 *    self-terminating elevated helper (`redirect/mac/`) that stays alive
 *    across capture on/off toggles, so a whole VS Code session needs only one
 *    admin-password prompt — see `dispose()` for how it's still guaranteed to exit when the extension
 *    actually shuts down.
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
 * Equivalent of `ElevatedRunner` for a *supervised* redirect: unlike the
 * one-shot Linux command batches, this is a persistent process with its own
 * elevation + control-channel lifecycle. Windows needs this because the
 * redirect *is* the WinDivert handles held by a live process
 * (`redirect/windows/companionSupervisor.ts`). macOS uses the same shape for
 * a different reason: `pf` state doesn't need a live process, but a
 * persistent, self-terminating root helper (`redirect/mac/macHelperSupervisor.ts`)
 * lets `disable()` skip the second admin-password prompt an `ElevatedRunner`
 * would otherwise require. Injectable for tests.
 */
export interface SupervisedRedirectDriver {
  enable(options: RedirectOptions): Promise<void>;
  disable(): Promise<void>;
  /**
   * Hard stop, distinct from `disable()`. Only the mac driver currently
   * implements this: its `disable()` deliberately leaves the helper process
   * alive (reverted but ready to re-`apply` without a new prompt) so
   * `RedirectController.dispose()` needs a separate way to actually kill it
   * once at extension deactivate. Drivers that already fully stop on
   * `disable()` (e.g. Windows) can omit this — `dispose()` falls back to
   * `disable()` when it's absent.
   */
  teardown?(): Promise<void>;
}

/** Alias kept for existing Windows call sites/tests — same shape as `SupervisedRedirectDriver`. */
export type WindowsRedirectDriver = SupervisedRedirectDriver;

export class RedirectUnsupportedError extends Error {}

/**
 * Our pf anchor path, nested under `com.apple/` on purpose. The default
 * macOS `/etc/pf.conf` ships a `rdr-anchor "com.apple/*"` wildcard that
 * evaluates every sub-anchor under `com.apple/` at packet-processing time —
 * this is the exact mechanism macOS Internet Sharing itself uses to inject
 * its NAT/redirect rules. By loading into `com.apple/kopytko-net` we get our
 * redirect evaluated for free, WITHOUT ever editing `/etc/pf.conf` or
 * reloading the main ruleset (`pfctl -f`). That matters enormously: a main-
 * ruleset reload flushes the dynamically-loaded rules Internet Sharing put
 * into its own `com.apple/*` sub-anchors, killing NAT for every device
 * behind it until a reboot — the "HTTPS breaks when capture is on" bug this
 * path exists to avoid. `pfctl -a "com.apple/kopytko-net" -f -` only ever
 * touches our own sub-anchor, never siblings. Exported so
 * `redirect/mac/macHelperScript.ts` builds the same path.
 */
export const PF_ANCHOR = 'com.apple/kopytko-net';
const IPT_CHAIN = 'KOPYTKO_NET';

export class RedirectController {
  private applied = false;
  private appliedPlatform: NodeJS.Platform | null = null;
  private appliedOptions: RedirectOptions | null = null;

  constructor(
    private readonly runElevated: ElevatedRunner,
    private readonly platform: NodeJS.Platform = process.platform,
    /** Real Windows redirect, when available. Undefined keeps win32 `unsupported` (the manual hosts-file flow). */
    private readonly windowsDriver?: SupervisedRedirectDriver,
    /** Persistent mac helper, when available. Undefined falls back to the plain one-shot `ElevatedRunner` path (a fresh prompt on every enable and disable). */
    private readonly macDriver?: SupervisedRedirectDriver,
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

    if (this.platform === 'darwin' && this.macDriver) {
      await this.macDriver.enable(options);
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

    if (this.appliedPlatform === 'darwin' && this.macDriver) {
      try {
        await this.macDriver.disable();
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

  /**
   * Hard teardown for extension deactivate / panel dispose — unlike
   * `disable()`, this guarantees no supervised driver process (e.g. the mac
   * persistent helper) outlives VS Code, even if it was left idle (reverted
   * but alive) by an earlier ordinary `disable()`. Safe to call regardless
   * of current applied state.
   */
  async dispose(): Promise<void> {
    if (this.platform === 'darwin' && this.macDriver?.teardown) {
      try {
        await this.macDriver.teardown();
      } finally {
        this.applied = false;
        this.appliedPlatform = null;
        this.appliedOptions = null;
      }
      return;
    }
    await this.disable();
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
  // Load ONLY into our own sub-anchor (see PF_ANCHOR above for why it's nested
  // under com.apple/*). No `/etc/pf.conf` edit, no `pfctl -f` main-ruleset
  // reload — those would flush Internet Sharing's NAT and break HTTPS. `pfctl
  // -e` is idempotent (Internet Sharing, a prerequisite for this feature, has
  // already enabled pf); kept only to cover the rare case it somehow isn't.
  return [
    `printf '${rdrLines}\\n' | pfctl -a '${PF_ANCHOR}' -f -`,
    'pfctl -e 2>/dev/null || true',
  ];
}

function buildMacTeardown(_o: RedirectOptions): string[] {
  // Flush only our own sub-anchor — sibling com.apple/* anchors (Internet
  // Sharing's NAT) are untouched.
  return [`pfctl -a '${PF_ANCHOR}' -F all 2>/dev/null || true`];
}
