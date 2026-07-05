/**
 * ECP remote-control key names and Lit_ text encoding.
 *
 * Key names are sent to the `/keypress/{key}`, `/keydown/{key}` and
 * `/keyup/{key}` ECP endpoints. Named keys are URL-safe as-is; literal
 * characters use the `Lit_` prefix followed by the URL-encoded UTF-8
 * representation of a single code point.
 *
 * @see https://developer.roku.com/dev/docs/external-control-api#keypress-key-values
 */

/**
 * Standard ECP key values. All Roku devices support the base set; the
 * `FindRemote` key requires a device that ships a findable remote, and the
 * volume/power/channel/input keys are Roku-TV-only (other devices may accept
 * them with HTTP 200 and simply ignore them).
 */
export const EcpKeys = {
  Home: 'Home',
  Rev: 'Rev',
  Fwd: 'Fwd',
  Play: 'Play',
  Select: 'Select',
  Left: 'Left',
  Right: 'Right',
  Down: 'Down',
  Up: 'Up',
  Back: 'Back',
  InstantReplay: 'InstantReplay',
  Info: 'Info',
  Backspace: 'Backspace',
  Search: 'Search',
  Enter: 'Enter',
  FindRemote: 'FindRemote',
  // Roku TV only
  VolumeDown: 'VolumeDown',
  VolumeMute: 'VolumeMute',
  VolumeUp: 'VolumeUp',
  PowerOff: 'PowerOff',
  PowerOn: 'PowerOn',
  Power: 'Power',
  ChannelUp: 'ChannelUp',
  ChannelDown: 'ChannelDown',
  InputTuner: 'InputTuner',
  InputHDMI1: 'InputHDMI1',
  InputHDMI2: 'InputHDMI2',
  InputHDMI3: 'InputHDMI3',
  InputHDMI4: 'InputHDMI4',
  InputAV1: 'InputAV1',
} as const;

export type EcpKey = (typeof EcpKeys)[keyof typeof EcpKeys];

const KNOWN_KEYS = new Set<string>(Object.values(EcpKeys));

/** Prefix for literal-character key values (`Lit_r`, `Lit_%E2%82%AC`, …). */
export const LIT_PREFIX = 'Lit_';

/**
 * Returns `true` for a key value the ECP key endpoints accept: either one of
 * the named {@link EcpKeys} or a `Lit_`-prefixed literal character.
 */
export function isValidEcpKey(key: string): boolean {
  return KNOWN_KEYS.has(key) || key.startsWith(LIT_PREFIX);
}

/**
 * Encodes a single character (one Unicode code point) as a `Lit_` key value.
 *
 * Unreserved ASCII stays literal (`'r'` → `'Lit_r'`); everything else is
 * URL-encoded UTF-8 (`'€'` → `'Lit_%E2%82%AC'`), matching the ECP docs.
 */
export function charToLitKey(char: string): string {
  return LIT_PREFIX + encodeURIComponent(char);
}

/**
 * Encodes a text string as a sequence of `Lit_` key values, one per Unicode
 * code point (surrogate pairs stay together, so emoji encode as a single key).
 *
 * ```ts
 * textToLitKeys('r€') // → ['Lit_r', 'Lit_%E2%82%AC']
 * ```
 */
export function textToLitKeys(text: string): string[] {
  return Array.from(text).map(charToLitKey);
}
