import { EventEmitter } from 'events';
import {
  ConsoleStream,
  CONSOLE_PORTS,
  CONSOLE_PORT_LABELS,
  isDestructiveCommand,
  type ConsolePort,
  type DeviceManager,
  type RokuDevice,
} from 'kopytko-roku-device';
import { nodeSink, joinPath, type DiagnosticsSink } from '../diagnostics/storage/sink';

/** How many consecutive failed connects before we blame another consumer. */
const HELD_PORT_THRESHOLD = 2;

export interface ConsoleControllerDeps {
  deviceManager: DeviceManager;
  workspaceRoot: string;
}

export interface ConsoleControllerOptions {
  /** Injectable for tests; defaults to a real TCP stream. */
  streamFactory?: (host: string, port: ConsolePort) => ConsoleStream;
  /** Injectable for tests; defaults to the Node filesystem. */
  sink?: DiagnosticsSink;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
}

export interface ConsoleSettings {
  maxLines: number;
  reconnect: boolean;
  logToFile: boolean;
  outputDir: string;
  historySize: number;
}

/** Per-(device, port) connection plus its scrollback. */
interface Session {
  stream: ConsoleStream;
  serial: string;
  port: ConsolePort;
  /** Completed lines, capped at `maxLines`. */
  lines: string[];
  /** Bytes received since the last newline — a chunk can split mid-line. */
  partial: string;
  logFile: string | null;
  /** Serializes appends so log lines cannot interleave out of order. */
  logQueue: Promise<void>;
}

/**
 * Owns the live console connections.
 *
 * One `ConsoleStream` per (device, port) pair, so 8085 and 8080 can both be
 * connected while the panel shows one of them — switching ports in the UI is a
 * view change, not a reconnect.
 *
 * Emits:
 *  - `lines`  (port, lines[])  — newly completed lines
 *  - `state`                   — connection/device/port state changed
 *  - `status` (message, tone)  — transient banner text, `null` clears it
 */
export class ConsoleController extends EventEmitter {
  private readonly sessions = new Map<string, Session>();
  private readonly streamFactory: (host: string, port: ConsolePort) => ConsoleStream;
  private readonly sink: DiagnosticsSink;
  private readonly now: () => number;

  private selectedPort: ConsolePort = 8085;
  private settings: ConsoleSettings;
  /** Last active serial seen, so device changes can be detected. */
  private activeSerial: string | null = null;
  private readonly onDevicesChanged = () => this.syncActiveDevice();

  constructor(
    private readonly deps: ConsoleControllerDeps,
    settings: ConsoleSettings,
    options: ConsoleControllerOptions = {},
  ) {
    super();
    this.settings = settings;
    this.streamFactory =
      options.streamFactory ??
      ((host, port) => new ConsoleStream({ host, port, autoReconnect: this.settings.reconnect }));
    this.sink = options.sink ?? nodeSink;
    this.now = options.now ?? (() => Date.now());

    this.activeSerial = this.activeDevice()?.serialNumber ?? null;
    // Without this the panel would snapshot the device list once and never
    // notice discovery finishing, a health check landing, or the user picking a
    // different device in the sidebar.
    this.deps.deviceManager.on('devices-changed', this.onDevicesChanged);
  }

  // ── selection ─────────────────────────────────────────────────────────────

  get port(): ConsolePort {
    return this.selectedPort;
  }

  /** The console always follows the device selected in the sidebar. */
  get device(): RokuDevice | undefined {
    return this.activeDevice();
  }

  get serial(): string | null {
    return this.activeDevice()?.serialNumber ?? null;
  }

  listPorts(): { port: ConsolePort; label: string }[] {
    return CONSOLE_PORTS.map((port) => ({ port, label: CONSOLE_PORT_LABELS[port] }));
  }

  selectPort(port: ConsolePort): void {
    if (this.selectedPort === port) return;
    this.selectedPort = port;
    this.emit('state');
  }

  updateSettings(settings: ConsoleSettings): void {
    this.settings = settings;
    this.emit('state');
  }

  // ── connection ────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this.currentSession()?.stream.isConnected ?? false;
  }

  /** A session exists for the selected port but its socket is not up yet. */
  get isPending(): boolean {
    const session = this.currentSession();
    return session ? !session.stream.isConnected : false;
  }

  get logFile(): string | null {
    return this.currentSession()?.logFile ?? null;
  }

  /** Scrollback for the selected (device, port), oldest first. */
  bufferedLines(): string[] {
    return this.currentSession()?.lines ?? [];
  }

  /**
   * Connect the selected device on the selected port. Resolves once the stream
   * has been created — the actual TCP connect is asynchronous and surfaces via
   * the `state` event.
   */
  async connect(): Promise<void> {
    const device = this.activeDevice();
    if (!device) {
      this.emit(
        'status',
        'No active Roku device. Select one in the Roku Devices sidebar first.',
        'warning',
      );
      return;
    }

    const key = sessionKey(device.serialNumber, this.selectedPort);
    if (this.sessions.has(key)) return;

    const port = this.selectedPort;
    const stream = this.streamFactory(device.ip, port);
    const session: Session = {
      stream,
      serial: device.serialNumber,
      port,
      lines: [],
      partial: '',
      logFile: null,
      logQueue: Promise.resolve(),
    };
    this.sessions.set(key, session);

    if (this.settings.logToFile) {
      session.logFile = await this.openLogFile(device, port);
    }

    stream.on('connect', () => {
      this.emit('status', null);
      this.emit('state');
    });
    stream.on('data', (chunk: string) => this.ingest(session, chunk));
    stream.on('close', () => this.emit('state'));
    stream.on('error', () => {
      // Swallowed deliberately: reconnect handles recovery, and the banner
      // below reports the case that actually needs the user's attention.
      if (stream.consecutiveFailures >= HELD_PORT_THRESHOLD) {
        this.emit(
          'status',
          `Cannot reach port ${port} on ${device.friendlyName || device.ip}. `
            + (port === 8085
              ? 'Port 8085 accepts a single consumer — close any other telnet session or debug session holding it.'
              : 'Check that a sideloaded channel is running.'),
          'warning',
        );
      }
    });
    stream.on('reconnecting', () => this.emit('state'));

    stream.start();
    this.emit('state');
  }

  /** Disconnect the selected (device, port), keeping its scrollback. */
  disconnect(): void {
    const session = this.currentSession();
    if (!session) return;
    session.stream.removeAllListeners();
    session.stream.close();
    this.sessions.delete(sessionKey(session.serial, session.port));
    this.emit('state');
  }

  /**
   * Send a line typed by the user.
   *
   * Returns `'sent'`, `'not-connected'`, or `'needs-confirmation'` — the caller
   * (which owns the VS Code modal) re-invokes with `confirmed: true` to proceed.
   */
  send(text: string, confirmed = false): 'sent' | 'not-connected' | 'needs-confirmation' {
    const session = this.currentSession();
    if (!session?.stream.isConnected) return 'not-connected';
    if (!confirmed && isDestructiveCommand(session.port, text)) return 'needs-confirmation';

    session.stream.write(`${text}\r\n`);
    return 'sent';
  }

  /** Send Ctrl+C, which breaks the running script into the debugger on 8085. */
  interrupt(): void {
    const session = this.currentSession();
    if (!session?.stream.isConnected) return;
    session.stream.write('\x03');
  }

  /** Drop the scrollback for the selected (device, port). Does not disconnect. */
  clear(): void {
    const session = this.currentSession();
    if (!session) return;
    session.lines = [];
    session.partial = '';
  }

  /**
   * Write the current scrollback to a file and return its path.
   * Returns null when there is nothing buffered.
   */
  async saveBuffer(): Promise<string | null> {
    const session = this.currentSession();
    if (!session || session.lines.length === 0) return null;

    const dir = joinPath(this.deps.workspaceRoot, this.settings.outputDir);
    await this.sink.ensureDir(dir);
    const file = joinPath(dir, `console-${session.port}-${timestamp(this.now())}.log`);
    await this.sink.writeFile(file, `${session.lines.join('\n')}\n`);
    return file;
  }

  dispose(): void {
    this.deps.deviceManager.off?.('devices-changed', this.onDevicesChanged);
    this.closeSessions();
    this.removeAllListeners();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private activeDevice(): RokuDevice | undefined {
    return this.deps.deviceManager.getActiveDevice();
  }

  private currentSession(): Session | undefined {
    const serial = this.serial;
    if (!serial) return undefined;
    return this.sessions.get(sessionKey(serial, this.selectedPort));
  }

  /**
   * React to the sidebar's device list changing.
   *
   * Sessions are keyed by serial, so a device switch would otherwise leave the
   * old device's sockets open and buffering with no way to see or close them.
   */
  private syncActiveDevice(): void {
    const serial = this.activeDevice()?.serialNumber ?? null;
    if (serial !== this.activeSerial) {
      this.activeSerial = serial;
      this.closeSessions((session) => session.serial !== serial);
    }
    // Always re-emit: the active device can stay the same while its details
    // (IP, reachability) change underneath us.
    this.emit('state');
  }

  private closeSessions(predicate: (session: Session) => boolean = () => true): void {
    for (const [key, session] of [...this.sessions]) {
      if (!predicate(session)) continue;
      session.stream.removeAllListeners();
      session.stream.close();
      this.sessions.delete(key);
    }
  }

  /**
   * Split an incoming chunk into complete lines, holding any trailing partial
   * line until the rest of it arrives. `\r\n` and bare `\n` both terminate.
   */
  private ingest(session: Session, chunk: string): void {
    const text = session.partial + chunk;
    const parts = text.split('\n');
    session.partial = parts.pop() ?? '';

    const lines = parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
    if (lines.length === 0) return;

    session.lines.push(...lines);
    const overflow = session.lines.length - this.settings.maxLines;
    if (overflow > 0) session.lines.splice(0, overflow);

    if (session.logFile) this.appendLog(session, lines);
    this.emit('lines', session.port, lines);
  }

  private appendLog(session: Session, lines: string[]): void {
    const file = session.logFile;
    if (!file) return;
    // Chain appends so concurrent chunks can never write out of order, and
    // swallow failures — losing the log must not break the live console.
    session.logQueue = session.logQueue
      .then(() => this.sink.appendFile(file, `${lines.join('\n')}\n`))
      .catch(() => undefined);
  }

  private async openLogFile(device: RokuDevice, port: ConsolePort): Promise<string | null> {
    try {
      const dir = joinPath(this.deps.workspaceRoot, this.settings.outputDir);
      await this.sink.ensureDir(dir);
      return joinPath(dir, `console-${port}-${timestamp(this.now())}.log`);
    } catch {
      this.emit('status', `Could not open a log file for ${device.ip}; logging disabled.`, 'warning');
      return null;
    }
  }
}

function sessionKey(serial: string, port: ConsolePort): string {
  return `${serial}:${port}`;
}

/** `2026-07-27_10-42-13` — filename-safe, sorts chronologically. */
function timestamp(wall: number): string {
  const iso = new Date(wall).toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, '-')}`;
}
