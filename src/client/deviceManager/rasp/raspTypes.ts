// Shared RASP (Roku Automation Script Protocol) types.
//
// Import-free on purpose: this file is bundled into the script-editor webview
// (browser context) as well as compiled for the extension host, so it must
// not pull in vscode or Node built-ins.

/** One executable RASP step, normalized from the YAML source. */
export type RaspStep =
  | { kind: 'press'; key: string }
  | { kind: 'text'; text: string }
  | { kind: 'pause'; seconds: number }
  | { kind: 'wait_for_player_state'; state: 'play' | 'pause' | 'stop' }
  | {
      kind: 'launch';
      /** Display name resolved through the script's `channels` map. */
      channelName?: string;
      /** Channel id — resolved from `channelName`, or given directly. */
      channelId?: string;
      contentId?: string;
      mediaType?: string;
      timeoutSec?: number;
    }
  | { kind: 'loop'; iterations: number; steps: RaspStep[] }
  | { kind: 'validate_streaming'; audioCodec?: string; videoCodec?: string; drm?: string };

export interface RaspScript {
  raspVersion: number;
  /** Seconds to wait after each `press` step (RASP default: 2). */
  defaultKeypressWaitSec: number;
  /** Channel name → channel id map from the script's `channels` section. */
  channels: Record<string, string>;
  steps: RaspStep[];
}

export interface RaspError {
  message: string;
  /** 1-based line for YAML syntax errors; absent for semantic errors. */
  line?: number;
  /** Step path for semantic errors, e.g. `steps[3].loop.steps[1]`. */
  path?: string;
}

export interface RaspParseResult {
  /** Present only when there are no errors. */
  script?: RaspScript;
  errors: RaspError[];
}

/** Progress event emitted by the runner for each executed step. */
export interface RaspStepEvent {
  /** Sequential executed-step counter, 0-based (loops expanded). */
  index: number;
  /** Total flattened step count (loops expanded at their iteration counts). */
  total: number;
  /** Step path in the source structure, e.g. `3.loop[1].0`. */
  path: string;
  /** Human-readable step label, e.g. `press Home`. */
  label: string;
  status: 'running' | 'ok' | 'failed';
  message?: string;
}
