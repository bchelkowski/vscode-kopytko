import * as yaml from 'js-yaml';
import type { RaspError, RaspParseResult, RaspStep } from './raspTypes';

/**
 * RASP `press` key names → ECP key values. RASP scripts (and Roku's Remote
 * Tool) use lowercase names like `home`/`reverse`; ECP wants `Home`/`Rev`.
 * Lookup is case-insensitive and also accepts exact ECP names and `Lit_*`.
 */
const RASP_KEY_MAP: Record<string, string> = {
  home: 'Home',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  select: 'Select',
  ok: 'Select',
  back: 'Back',
  replay: 'InstantReplay',
  instant_replay: 'InstantReplay',
  instantreplay: 'InstantReplay',
  info: 'Info',
  options: 'Info',
  play: 'Play',
  pause: 'Play',
  rev: 'Rev',
  reverse: 'Rev',
  rewind: 'Rev',
  fwd: 'Fwd',
  forward: 'Fwd',
  fast_forward: 'Fwd',
  backspace: 'Backspace',
  search: 'Search',
  enter: 'Enter',
  find_remote: 'FindRemote',
  findremote: 'FindRemote',
  volume_up: 'VolumeUp',
  volumeup: 'VolumeUp',
  volume_down: 'VolumeDown',
  volumedown: 'VolumeDown',
  volume_mute: 'VolumeMute',
  volumemute: 'VolumeMute',
  mute: 'VolumeMute',
  power: 'Power',
  power_off: 'PowerOff',
  poweroff: 'PowerOff',
  power_on: 'PowerOn',
  poweron: 'PowerOn',
  channel_up: 'ChannelUp',
  channelup: 'ChannelUp',
  channel_down: 'ChannelDown',
  channeldown: 'ChannelDown',
};

/** Resolves a RASP press key to an ECP key value, or undefined when unknown. */
export function raspKeyToEcpKey(raw: string): string | undefined {
  if (raw.startsWith('Lit_')) return raw;
  return RASP_KEY_MAP[raw.toLowerCase().trim()];
}

/** Canonical RASP name per ECP key — used when recording remote presses into a script. */
const ECP_TO_RASP: Record<string, string> = {
  Home: 'home',
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
  Select: 'select',
  Back: 'back',
  InstantReplay: 'replay',
  Info: 'info',
  Play: 'play',
  Rev: 'rev',
  Fwd: 'fwd',
  Backspace: 'backspace',
  Search: 'search',
  Enter: 'enter',
  FindRemote: 'find_remote',
  VolumeUp: 'volume_up',
  VolumeDown: 'volume_down',
  VolumeMute: 'mute',
  Power: 'power',
  PowerOn: 'power_on',
  PowerOff: 'power_off',
  ChannelUp: 'channel_up',
  ChannelDown: 'channel_down',
};

/**
 * Maps an ECP key back to its canonical RASP press name (`Home` → `home`,
 * `InstantReplay` → `replay`). `Lit_*` keys pass through unchanged; unknown
 * keys return undefined.
 */
export function ecpKeyToRaspKey(key: string): string | undefined {
  if (key.startsWith('Lit_')) return key;
  return ECP_TO_RASP[key];
}

/**
 * Formats a value for a RASP `text:` command — single-quoted YAML when the
 * plain scalar would be ambiguous (quotes, `:`/`#`, flow chars, leading or
 * trailing whitespace, or a value YAML would parse as a non-string).
 */
export function raspQuote(text: string): string {
  let roundTrips: boolean;
  try {
    const loaded: unknown = yaml.load(text);
    // Must come back as the SAME string — numbers/booleans/null need quoting
    // to stay text (`- text: true` would otherwise parse as a boolean).
    roundTrips = typeof loaded === 'string' && loaded === text;
  } catch {
    roundTrips = false;
  }
  const needsQuoting =
    text === '' ||
    /[:#'"{}[\]&*!|>%@`,]/.test(text) ||
    /^\s|\s$/.test(text) ||
    text.startsWith('-') ||
    !roundTrips;
  return needsQuoting ? `'${text.replace(/'/g, "''")}'` : text;
}

const DEFAULT_KEYPRESS_WAIT_SEC = 2;
const SUPPORTED_RASP_VERSION = 1;

interface ParseContext {
  errors: RaspError[];
}

/**
 * Parses RASP YAML source into a normalized {@link RaspScript}.
 *
 * js-yaml resolves YAML anchors/aliases at load time, which is exactly how
 * RASP reusable step blocks work: `- step: &id …` defines a block (a no-op
 * where it appears), and `- *id` replays it (the alias resolves to the
 * anchored step array, which is inlined).
 *
 * Syntax errors carry a 1-based `line`; semantic errors carry a step `path`.
 */
export function parseRasp(source: string): RaspParseResult {
  let doc: unknown;
  try {
    doc = yaml.load(source);
  } catch (err) {
    if (err instanceof yaml.YAMLException) {
      return {
        errors: [{
          message: err.reason ?? err.message,
          line: err.mark ? err.mark.line + 1 : undefined,
        }],
      };
    }
    return { errors: [{ message: err instanceof Error ? err.message : String(err) }] };
  }

  if (doc === null || doc === undefined) {
    return { errors: [{ message: 'Script is empty.' }] };
  }
  if (!isRecord(doc)) {
    return { errors: [{ message: 'Top level must be a mapping with params/channels/steps sections.' }] };
  }

  const ctx: ParseContext = { errors: [] };

  const params = isRecord(doc['params']) ? doc['params'] : {};
  const raspVersion = toNumber(params['rasp_version']) ?? SUPPORTED_RASP_VERSION;
  if (raspVersion !== SUPPORTED_RASP_VERSION) {
    ctx.errors.push({ message: `Unsupported rasp_version ${raspVersion} (only ${SUPPORTED_RASP_VERSION} is supported).`, path: 'params.rasp_version' });
  }
  const defaultKeypressWaitSec = toNumber(params['default_keypress_wait']) ?? DEFAULT_KEYPRESS_WAIT_SEC;
  if (defaultKeypressWaitSec < 0) {
    ctx.errors.push({ message: 'default_keypress_wait must be >= 0.', path: 'params.default_keypress_wait' });
  }

  const channels: Record<string, string> = {};
  if (doc['channels'] !== undefined) {
    if (!isRecord(doc['channels'])) {
      ctx.errors.push({ message: 'channels must be a mapping of channel name to channel id.', path: 'channels' });
    } else {
      for (const [name, id] of Object.entries(doc['channels'])) {
        channels[name] = String(id);
      }
    }
  }

  let steps: RaspStep[] = [];
  if (!Array.isArray(doc['steps'])) {
    ctx.errors.push({ message: 'Missing steps section (a YAML list of commands).', path: 'steps' });
  } else {
    steps = parseSteps(doc['steps'], 'steps', ctx, channels);
  }

  if (ctx.errors.length > 0) {
    return { errors: ctx.errors };
  }

  return {
    script: { raspVersion, defaultKeypressWaitSec, channels, steps },
    errors: [],
  };
}

function parseSteps(items: unknown[], path: string, ctx: ParseContext, channels: Record<string, string>): RaspStep[] {
  const steps: RaspStep[] = [];

  items.forEach((item, i) => {
    const itemPath = `${path}[${i}]`;

    // `- *alias` of a `step:` block resolves to the anchored step array — inline it.
    if (Array.isArray(item)) {
      steps.push(...parseSteps(item, itemPath, ctx, channels));
      return;
    }

    if (!isRecord(item)) {
      ctx.errors.push({ message: `Step must be a command mapping (got ${describe(item)}).`, path: itemPath });
      return;
    }

    const keys = Object.keys(item);
    if (keys.length !== 1) {
      ctx.errors.push({ message: `Step must have exactly one command key (got: ${keys.join(', ') || 'none'}).`, path: itemPath });
      return;
    }

    const command = keys[0];
    const value = item[command];

    switch (command) {
      case 'press': {
        const raw = String(value ?? '');
        const key = raspKeyToEcpKey(raw);
        if (!key) {
          ctx.errors.push({ message: `Unknown press key "${raw}".`, path: itemPath });
          return;
        }
        steps.push({ kind: 'press', key });
        return;
      }

      case 'text': {
        if (value === null || value === undefined) {
          ctx.errors.push({ message: 'text requires a value.', path: itemPath });
          return;
        }
        steps.push({ kind: 'text', text: String(value) });
        return;
      }

      case 'pause': {
        const seconds = toNumber(value);
        if (seconds === undefined || seconds < 0) {
          ctx.errors.push({ message: `pause requires a non-negative number of seconds (got ${describe(value)}).`, path: itemPath });
          return;
        }
        steps.push({ kind: 'pause', seconds });
        return;
      }

      case 'wait_for_player_state': {
        const state = String(value ?? '').toLowerCase();
        if (state !== 'play' && state !== 'pause' && state !== 'stop') {
          ctx.errors.push({ message: `wait_for_player_state must be play, pause or stop (got "${String(value)}").`, path: itemPath });
          return;
        }
        steps.push({ kind: 'wait_for_player_state', state });
        return;
      }

      case 'launch': {
        if (!isRecord(value)) {
          ctx.errors.push({ message: 'launch requires a mapping (channel_name, content_id, media_type, timeout).', path: itemPath });
          return;
        }
        const channelName = value['channel_name'] !== undefined ? String(value['channel_name']) : undefined;
        const directId = value['channel_id'] !== undefined ? String(value['channel_id']) : undefined;
        const channelId = directId ?? (channelName !== undefined ? channels[channelName] : undefined);
        if (channelName === undefined && directId === undefined) {
          ctx.errors.push({ message: 'launch requires channel_name (or channel_id).', path: itemPath });
          return;
        }
        if (channelId === undefined) {
          ctx.errors.push({ message: `launch channel_name "${channelName}" is not defined in the channels section.`, path: itemPath });
          return;
        }
        const timeoutSec = value['timeout'] !== undefined ? toNumber(value['timeout']) : undefined;
        if (value['timeout'] !== undefined && (timeoutSec === undefined || timeoutSec <= 0)) {
          ctx.errors.push({ message: `launch timeout must be a positive number of seconds (got ${describe(value['timeout'])}).`, path: itemPath });
          return;
        }
        steps.push({
          kind: 'launch',
          channelName,
          channelId,
          contentId: value['content_id'] !== undefined ? String(value['content_id']) : undefined,
          mediaType: value['media_type'] !== undefined ? String(value['media_type']) : undefined,
          timeoutSec,
        });
        return;
      }

      case 'loop': {
        if (!isRecord(value)) {
          ctx.errors.push({ message: 'loop requires a mapping with iterations and steps.', path: itemPath });
          return;
        }
        const iterations = toNumber(value['iterations']);
        if (iterations === undefined || !Number.isInteger(iterations) || iterations < 1) {
          ctx.errors.push({ message: `loop iterations must be a positive integer (got ${describe(value['iterations'])}).`, path: itemPath });
          return;
        }
        if (!Array.isArray(value['steps'])) {
          ctx.errors.push({ message: 'loop requires a steps list.', path: itemPath });
          return;
        }
        steps.push({
          kind: 'loop',
          iterations,
          steps: parseSteps(value['steps'], `${itemPath}.steps`, ctx, channels),
        });
        return;
      }

      case 'validate_streaming': {
        if (!isRecord(value)) {
          ctx.errors.push({ message: 'validate_streaming requires a mapping (audio_codec, video_codec, drm).', path: itemPath });
          return;
        }
        steps.push({
          kind: 'validate_streaming',
          audioCodec: value['audio_codec'] !== undefined ? String(value['audio_codec']) : undefined,
          videoCodec: value['video_codec'] !== undefined ? String(value['video_codec']) : undefined,
          drm: value['drm'] !== undefined ? String(value['drm']) : undefined,
        });
        return;
      }

      // `- step: &id …` defines a reusable block: a no-op where it appears.
      // The anchored array replays wherever `- *id` aliases it (handled by the
      // Array.isArray branch above). Validate the definition's contents so
      // errors point at the definition, not the replay sites.
      case 'step': {
        if (!Array.isArray(value)) {
          ctx.errors.push({ message: 'step (reusable block) must contain a list of steps.', path: itemPath });
          return;
        }
        const scratch: ParseContext = { errors: ctx.errors };
        parseSteps(value, `${itemPath}.step`, scratch, channels);
        return;
      }

      default:
        ctx.errors.push({ message: `Unknown command "${command}".`, path: itemPath });
        return;
    }
  });

  return steps;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return JSON.stringify(value);
}
