/**
 * Message contract between the console view provider (extension host) and the
 * console webview.
 *
 * Kept import-free on purpose so it bundles cleanly into the webview without
 * dragging `vscode` or the device package along — same rule as the diagnostics
 * panel's protocol module.
 */

/** Interactive debug console ports. Mirrors `ConsolePort` in kopytko-roku-device. */
export type ConsolePort = 8085 | 8080;

/**
 * The device the console is bound to — always the one selected in the Roku
 * Devices sidebar. The console has no device picker of its own; duplicating
 * that selection would let the two disagree.
 */
export interface DeviceInfo {
  serial: string;
  label: string;
  ip: string;
}

export interface PortOption {
  port: ConsolePort;
  label: string;
}

/** One entry in the completion popup. */
export interface CompletionItem {
  value: string;
  args?: string;
  description: string;
  source: 'docs' | 'device';
  destructive?: boolean;
  /** Fixed values completed after the command name, e.g. `sgnodes all`. */
  subcommands?: { value: string; description: string }[];
}

export interface ConsoleState {
  /** Active device from the sidebar, or null when none is selected. */
  device: DeviceInfo | null;
  ports: PortOption[];
  selectedPort: ConsolePort;
  connected: boolean;
  /** A connection is open but not yet established — connecting or reconnecting. */
  pending: boolean;
  /** Absolute path of the live log file, when file logging is on. */
  logFile: string | null;
  maxLines: number;
  /** When false, every line renders in the default foreground colour. */
  colorize: boolean;
}

/** Serialized catalog: every port's commands, for offline completion in the webview. */
export type SerializedCatalog = Record<string, CompletionItem[]>;

export type ExtMsg =
  | {
      kind: 'init';
      state: ConsoleState;
      catalog: SerializedCatalog;
      history: string[];
      /** Buffered lines for the selected port, oldest first. */
      lines: string[];
    }
  | { kind: 'lines'; port: ConsolePort; lines: string[] }
  | { kind: 'state'; state: ConsoleState }
  | { kind: 'history'; history: string[] }
  | { kind: 'status'; message: string | null; tone?: 'info' | 'warning' | 'error' }
  /** Host-side echo of a line the user submitted, so it appears in order. */
  | { kind: 'echo'; port: ConsolePort; text: string }
  | { kind: 'cleared'; port: ConsolePort };

export type WebMsg =
  | { kind: 'ready' }
  | { kind: 'connect' }
  | { kind: 'disconnect' }
  | { kind: 'input'; text: string }
  | { kind: 'interrupt' }
  | { kind: 'select-port'; port: ConsolePort }
  | { kind: 'clear' }
  | { kind: 'save' }
  | { kind: 'open-source'; pkgPath: string; line: number };
