/**
 * Orchestrates the Network Inspector: owns the capture proxy + OS redirect
 * lifecycle behind a single enable/disable, keeps a ring buffer of flows,
 * filters to the active device, hot-reloads rewrite rules, and builds HAR.
 *
 * Deliberately free of any `vscode` import — all editor concerns (config,
 * messages, save dialogs) are injected by `activation/network.ts`, so this
 * class unit-tests with plain fakes.
 */

import { EventEmitter } from 'events';
import { CaptureProxy, CaptureProxyOptions } from './capture/captureProxy';
import { FlowRecord, toFlowDetail, toSerializedFlow } from './capture/flow';
import { RedirectController, RedirectUnsupportedError } from './redirect/redirectController';
import { RuleSet } from './capture/rewrite/rules';
import type { FlowDetail, RedirectStatus, SerializedFlow, WebviewState } from './webview/protocol';

export interface DeviceLike {
  ip: string;
  friendlyName?: string;
  modelName?: string;
}

export interface NetworkConfig {
  proxyPort: number;
  redirectPorts: number[];
  maxEntries: number;
  filterToActiveDevice: boolean;
  maxBodyBytes: number;
  rules: RuleSet;
}

export interface NetworkControllerDeps {
  deviceManager: { getActiveDevice(): DeviceLike | undefined };
  redirect: RedirectController;
  readConfig: () => NetworkConfig;
  /** Optional diagnostic sink (output channel + console). */
  log?: (msg: string) => void;
  /** Overridable for tests. */
  proxyFactory?: (opts: CaptureProxyOptions) => CaptureProxy;
}

/**
 * Emits:
 *  - `'flow'`    (entry: SerializedFlow)
 *  - `'state'`   (state: WebviewState)
 *  - `'rules'`   (rules: RuleSet)
 *  - `'cleared'`
 */
export class NetworkController extends EventEmitter {
  private proxy: CaptureProxy | null = null;
  private enabled = false;
  private redirectStatus: RedirectStatus = 'off';
  private message: string | undefined;
  private deviceIp: string | undefined;
  private proxyPort = 8888;

  private readonly flows: FlowRecord[] = [];
  private readonly byId = new Map<string, FlowRecord>();
  private rules: RuleSet;
  private maxEntries = 5000;
  private filterToActiveDevice = true;

  constructor(private readonly deps: NetworkControllerDeps) {
    super();
    this.rules = deps.readConfig().rules;
  }

  private log(msg: string): void {
    this.deps.log?.(msg);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  getRules(): RuleSet {
    return this.rules;
  }

  getHistory(): SerializedFlow[] {
    return this.flows.map(toSerializedFlow);
  }

  getState(): WebviewState {
    const device = this.deps.deviceManager.getActiveDevice();
    return {
      enabled: this.enabled,
      redirectStatus: this.redirectStatus,
      proxyPort: this.proxyPort,
      deviceIp: device?.ip,
      deviceLabel: device ? device.friendlyName ?? device.modelName : undefined,
      message: this.message,
    };
  }

  getDetail(id: string): FlowDetail | undefined {
    const rec = this.byId.get(id);
    return rec ? toFlowDetail(rec) : undefined;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  async enable(): Promise<void> {
    if (this.enabled) return;

    const device = this.deps.deviceManager.getActiveDevice();
    if (!device) {
      throw new Error('No active Roku device selected. Select a device first.');
    }

    const config = this.deps.readConfig();
    this.rules = config.rules;
    this.maxEntries = Math.max(1, config.maxEntries);
    this.filterToActiveDevice = config.filterToActiveDevice;
    this.proxyPort = config.proxyPort;
    this.deviceIp = device.ip;
    this.message = undefined;

    const proxy = (this.deps.proxyFactory ?? ((o) => new CaptureProxy(o)))({
      port: config.proxyPort,
      maxBodyBytes: config.maxBodyBytes,
    });
    proxy.setRules(this.rules);
    proxy.on('flow', (rec: FlowRecord) => this.onFlow(rec));
    proxy.on('error', () => {
      /* surfaced via start() rejection; per-request errors are recorded as flows */
    });

    await proxy.start();
    this.proxy = proxy;
    this.proxyPort = proxy.port;
    this.log(`Capture proxy listening on 127.0.0.1:${this.proxyPort}`);

    // Apply the OS redirect. Unsupported (Windows) keeps the proxy running so
    // a user could route traffic manually; a real failure rolls the proxy back.
    try {
      this.redirectStatus = 'applying';
      this.log(`Applying ${this.deps.redirect.targetPlatform} traffic redirect for ${device.ip} :${config.redirectPorts.join(',')} → proxy :${this.proxyPort}`);
      await this.deps.redirect.enable({
        rokuIp: device.ip,
        proxyPort: this.proxyPort,
        ports: config.redirectPorts,
      });
      this.redirectStatus = 'on';
      this.log('Traffic redirect applied.');
    } catch (err) {
      if (err instanceof RedirectUnsupportedError) {
        this.redirectStatus = 'unsupported';
        this.message = err.message;
        this.log(`Automatic redirect unavailable: ${err.message}`);
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        this.log(`Redirect FAILED, rolling back proxy: ${detail}`);
        await proxy.stop();
        this.proxy = null;
        this.redirectStatus = 'error';
        this.message = detail;
        throw err;
      }
    }

    this.enabled = true;
    this.emitState();
  }

  async disable(): Promise<void> {
    if (!this.enabled && !this.proxy) return;
    this.enabled = false;

    try {
      await this.deps.redirect.disable();
    } finally {
      this.redirectStatus = 'off';
      this.message = undefined;
      if (this.proxy) {
        await this.proxy.stop();
        this.proxy = null;
      }
      this.emitState();
    }
  }

  // ── data ──────────────────────────────────────────────────────────────────

  private onFlow(rec: FlowRecord): void {
    // Device-IP filtering only makes sense when the redirect preserves the
    // device's original source IP end to end — true for macOS/Linux's real
    // NAT redirect (`iptables`/`pf`), but NOT for Windows even when
    // `redirectStatus === 'on'` there. Two Windows paths both funnel traffic
    // through a *new* local connection instead of preserving the source IP:
    //  - `unsupported` (netsh portproxy manual fallback): a brand-new local
    //    connection to the proxy.
    //  - `on` via the WinDivert companion: packets are bridged through
    //    127.0.0.1 (both source AND destination rewritten to loopback,
    //    required for Windows to accept the injected packet for local
    //    delivery at all — see findings/network-inspector.md), so the proxy
    //    sees every connection as coming from 127.0.0.1 too, never the real
    //    device IP, despite this otherwise being a "real" transparent
    //    redirect. Filtering on clientIp here would silently drop every flow.
    // There's also nothing to filter *from* on Windows either way: the
    // WinDivert companion's own packet filter is already scoped to exactly
    // the active device's IP, and the manual fallback only ever receives
    // what the user explicitly routed via the generated script.
    const clientIpIsTrustworthy = this.deps.redirect.targetPlatform !== 'win32';
    if (
      this.filterToActiveDevice &&
      this.deviceIp &&
      this.redirectStatus === 'on' &&
      clientIpIsTrustworthy &&
      rec.clientIp !== this.deviceIp
    ) {
      return;
    }
    this.flows.push(rec);
    this.byId.set(rec.id, rec);
    while (this.flows.length > this.maxEntries) {
      const dropped = this.flows.shift();
      if (dropped) this.byId.delete(dropped.id);
    }
    this.emit('flow', toSerializedFlow(rec));
  }

  setRules(rules: RuleSet): void {
    this.rules = rules;
    this.proxy?.setRules(rules);
    this.emit('rules', rules);
  }

  clear(): void {
    this.flows.length = 0;
    this.byId.clear();
    this.emit('cleared');
  }

  /** Builds a HAR 1.2 log from the current buffer (bodies included). */
  buildHar(): unknown {
    return {
      log: {
        version: '1.2',
        creator: { name: 'Kopytko Network Inspector', version: '1' },
        entries: this.flows.map((rec) => harEntry(rec)),
      },
    };
  }

  dispose(): void {
    void this.disable();
  }

  private emitState(): void {
    this.emit('state', this.getState());
  }
}

// ── HAR helpers ───────────────────────────────────────────────────────────────

function harHeaders(headers: Record<string, string | string[]>): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((v) => out.push({ name, value: v }));
    else out.push({ name, value });
  }
  return out;
}

function harEntry(rec: FlowRecord): unknown {
  const portPart = rec.port && rec.port !== 80 ? `:${rec.port}` : '';
  const url = `http://${rec.host}${portPart}${rec.path}${rec.query ? `?${rec.query}` : ''}`;
  const queryString = rec.query
    ? rec.query.split('&').filter(Boolean).map((pair) => {
        const eq = pair.indexOf('=');
        return eq >= 0
          ? { name: decode(pair.slice(0, eq)), value: decode(pair.slice(eq + 1)) }
          : { name: decode(pair), value: '' };
      })
    : [];

  return {
    startedDateTime: new Date(rec.startedWall).toISOString(),
    time: rec.durationMs,
    request: {
      method: rec.method,
      url,
      httpVersion: 'HTTP/1.1',
      headers: harHeaders(rec.requestHeaders),
      queryString,
      headersSize: -1,
      bodySize: rec.requestBytes,
      ...(rec.requestBody
        ? { postData: { mimeType: contentTypeOf(rec.requestHeaders), text: rec.requestBody.toString('utf8') } }
        : {}),
    },
    response: {
      status: rec.status,
      statusText: rec.statusText,
      httpVersion: 'HTTP/1.1',
      headers: harHeaders(rec.responseHeaders),
      content: {
        size: rec.responseBytes,
        mimeType: rec.contentType || 'application/octet-stream',
        text: rec.responseBody ? rec.responseBody.toString('utf8') : '',
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: rec.responseBytes,
    },
    cache: {},
    timings: { send: 0, wait: rec.durationMs, receive: 0 },
    _upstreamScheme: rec.upstreamScheme,
    _rewrittenBody: rec.rewrittenBody,
  };
}

function contentTypeOf(headers: Record<string, string | string[]>): string {
  const ct = headers['content-type'];
  if (Array.isArray(ct)) return ct[0] ?? '';
  return ct ?? '';
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}
