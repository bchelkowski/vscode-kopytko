/**
 * Command catalogs for the two interactive Roku debug consoles.
 *
 * Port 8085 is the BrightScript runtime console — it streams app output and
 * turns into an interactive `BrightScript Debugger>` prompt when execution
 * stops. Port 8080 is the SceneGraph debug server, a utility console.
 *
 * Sources, and why the distinction is recorded per command:
 *   - `'docs'`   — https://developer.roku.com/dev/docs/debugging
 *   - `'device'` — observed in the on-device `help` output but absent from the
 *                  published docs (captured live from a Roku Ultra 4850X on
 *                  firmware 15.2.4.3442, 2026-07-27; see
 *                  findings/roku-device-api.md). These may vanish without
 *                  notice, so completion can visually mark them.
 *
 * `sgversion` is the one entry going the other way — Roku documents it, but it
 * does not appear in this firmware's `help`. Kept, since a missing help entry is
 * not proof the command is gone.
 *
 * Roku OS 7.5+ retired ports 8089–8093, and 8087 (screensaver) is out of scope,
 * so only 8085 and 8080 are catalogued.
 */

import type { ConsolePort } from './consoleStream';

export interface ConsoleCommandSpec {
  /** Canonical command name, as typed. */
  name: string;
  /** Equivalent short forms accepted by the device. */
  aliases?: string[];
  /** Argument hint shown after the name, e.g. `[-r <seconds>]`. */
  args?: string;
  description: string;
  source: 'docs' | 'device';
  /** Requires an explicit confirmation before being sent. */
  destructive?: boolean;
  /** Fixed sub-command values, completed after the command name. */
  subcommands?: ConsoleSubcommandSpec[];
}

export interface ConsoleSubcommandSpec {
  name: string;
  description: string;
}

/** BrightScript runtime console — port 8085. */
const BRIGHTSCRIPT_COMMANDS: ConsoleCommandSpec[] = [
  { name: 'bt', description: 'Print backtrace of call function context frames', source: 'docs' },
  { name: 'bsc', description: 'Print current BrightScript component instances', source: 'docs' },
  { name: 'bscs', description: 'Print summary of BrightScript component instance counts', source: 'docs' },
  { name: 'brkd', description: 'Toggle debugger break after non-fatal diagnostic messages', source: 'docs' },
  { name: 'classes', description: 'Print BrightScript component classes', source: 'docs' },
  { name: 'cont', aliases: ['c'], description: 'Continue script execution', source: 'docs' },
  { name: 'down', aliases: ['d'], description: 'Move down the function context chain', source: 'docs' },
  { name: 'gc', description: 'Run the garbage collector', source: 'docs' },
  { name: 'help', description: 'Print the list of BrightScript console commands', source: 'docs' },
  { name: 'last', aliases: ['l'], description: 'Print the last executed line', source: 'docs' },
  { name: 'list', description: 'List the current function', source: 'docs' },
  { name: 'next', aliases: ['n'], description: 'Print the next line to execute', source: 'docs' },
  { name: 'over', description: 'Step over a function', source: 'docs' },
  { name: 'out', description: 'Step out of a function', source: 'docs' },
  {
    name: 'print',
    aliases: ['p', '?'],
    args: '<expression>',
    description: 'Print a variable or expression',
    source: 'docs',
  },
  { name: 'step', aliases: ['s', 't'], description: 'Step one program statement', source: 'docs' },
  {
    name: 'threads',
    aliases: ['ths'],
    description: 'List all currently suspended threads',
    source: 'docs',
  },
  {
    name: 'thread',
    aliases: ['th'],
    args: '<ID>',
    description: 'Select a suspended thread to debug',
    source: 'docs',
  },
  { name: 'up', aliases: ['u'], description: 'Move up the function context chain', source: 'docs' },
  { name: 'var', description: 'Print local variables and their types and values', source: 'docs' },
  { name: 'exit', description: 'Exit the shell', source: 'docs' },
];

/** SceneGraph debug server — port 8080. */
const SCENEGRAPH_COMMANDS: ConsoleCommandSpec[] = [
  {
    name: 'chanperf',
    args: '[-r <seconds>]',
    description: 'Print channel memory and CPU utilisation; -r repeats at an interval',
    source: 'docs',
  },
  {
    name: 'sgnodes',
    description: 'List SceneGraph nodes created by the channel',
    source: 'docs',
    subcommands: [
      { name: 'all', description: 'Every existing node created by the app' },
      { name: 'roots', description: 'Nodes without a parent' },
      { name: 'counts', description: 'Node count and static bytes per node type' },
    ],
  },
  {
    name: 'sgperf',
    description: 'Track SceneGraph node operation performance metrics',
    source: 'docs',
    subcommands: [
      { name: 'start', description: 'Begin collecting metrics' },
      { name: 'clear', description: 'Reset collected metrics' },
      { name: 'report', description: 'Print the collected metrics' },
      { name: 'stop', description: 'Stop collecting metrics' },
    ],
  },
  { name: 'r2d2_bitmaps', description: 'Print assets in texture memory with usage stats', source: 'docs' },
  {
    name: 'loaded_textures',
    args: '[overlay]',
    description: 'Display images loaded into texture memory (needs a SceneGraph screen on-screen)',
    source: 'docs',
  },
  { name: 'free', description: 'Snapshot of in-use and free device memory', source: 'docs' },
  {
    name: 'fps_display',
    args: '[1|0]',
    description: 'Toggle the on-screen frames-per-second and free-memory overlay',
    source: 'docs',
    subcommands: [
      { name: '1', description: 'Show the overlay' },
      { name: '0', description: 'Hide the overlay' },
    ],
  },
  {
    name: 'logrendezvous',
    args: '[on|off]',
    description: 'Enable or disable thread rendezvous console logging',
    source: 'docs',
    subcommands: [
      { name: 'on', description: 'Enable rendezvous console logging' },
      { name: 'off', description: 'Disable rendezvous console logging' },
    ],
  },
  {
    name: 'brightscript_warnings',
    args: '<count>',
    description: 'Set the maximum number of BrightScript warnings displayed',
    source: 'docs',
  },
  {
    name: 'sgversion',
    args: '<force|default> <1.0|1.1>',
    description: 'Override the manifest rsg_version setting',
    source: 'docs',
  },
  {
    name: 'remove_plugin',
    args: '<appId>',
    description: 'Remove an app from the device and all linked accounts',
    source: 'docs',
    destructive: true,
  },
  {
    name: 'clear_launch_caches',
    description: 'Clear all caches that can affect channel launch time',
    source: 'device',
  },
  {
    name: 'type',
    args: '<text>',
    description: 'Send a literal text sequence to the channel',
    source: 'device',
  },
  { name: 'plugins', description: 'List installed plugins', source: 'device' },
  { name: 'showkey', description: 'Show the current developer key', source: 'device' },
  {
    name: 'genkey',
    description: 'Generate a new developer key — invalidates every package signed with the old one',
    source: 'device',
    destructive: true,
  },
  {
    name: 'press',
    args: '{hudrlsp<fb>yikoteacn}',
    description: 'Simulate a keypress; no argument lists the available keys',
    source: 'device',
  },
  {
    name: 'target',
    args: 'list | <n> | <name> | -p <pid>',
    description: 'List or select the command execution target',
    source: 'device',
  },
  { name: 'bsprof-pause', description: 'Pause BrightScript profiling', source: 'device' },
  { name: 'bsprof-resume', description: 'Resume BrightScript profiling', source: 'device' },
  { name: 'bsprof-status', description: 'Report BrightScript profiling status', source: 'device' },
  {
    name: 'help',
    aliases: ['?'],
    args: '[command]',
    description: 'Print the list of debug server commands',
    source: 'device',
  },
  { name: 'exit', aliases: ['quit', 'q'], description: 'Exit the debug terminal', source: 'device' },
];

export const CONSOLE_COMMANDS: Record<ConsolePort, ConsoleCommandSpec[]> = {
  8085: BRIGHTSCRIPT_COMMANDS,
  8080: SCENEGRAPH_COMMANDS,
};

/** Human-readable label for a console port. */
export const CONSOLE_PORT_LABELS: Record<ConsolePort, string> = {
  8085: 'BrightScript runtime',
  8080: 'SceneGraph debug server',
};

export interface ConsoleCompletion {
  /** Text to insert in place of the token being completed. */
  value: string;
  /** Argument hint, when completing a command name that takes arguments. */
  args?: string;
  description: string;
  source: 'docs' | 'device';
  destructive?: boolean;
}

/**
 * Resolve completions for a partially typed line.
 *
 * Completes the command name while the caret is still inside the first token,
 * and fixed sub-command values once the command name is followed by a space.
 * Returns `[]` when nothing matches, so callers can simply hide the popup.
 */
export function completeCommand(port: ConsolePort, line: string): ConsoleCompletion[] {
  const commands = CONSOLE_COMMANDS[port] ?? [];
  // Leading whitespace is not part of any token; a trailing space is meaningful
  // (it means "the first token is finished"), so only trim the start.
  const text = line.replace(/^\s+/, '');
  const firstSpace = text.indexOf(' ');

  if (firstSpace === -1) {
    const prefix = text.toLowerCase();
    return commands
      .filter((cmd) => matchesPrefix(cmd, prefix))
      .map((cmd) => ({
        value: cmd.name,
        args: cmd.args,
        description: cmd.description,
        source: cmd.source,
        destructive: cmd.destructive,
      }));
  }

  const name = text.slice(0, firstSpace).toLowerCase();
  const command = commands.find((cmd) => isName(cmd, name));
  if (!command?.subcommands) return [];

  const rest = text.slice(firstSpace + 1);
  // Only the token immediately after the command name is completable.
  if (rest.includes(' ')) return [];

  const prefix = rest.toLowerCase();
  return command.subcommands
    .filter((sub) => sub.name.startsWith(prefix))
    .map((sub) => ({
      value: sub.name,
      description: sub.description,
      source: command.source,
    }));
}

/** Look up a command by name or alias — used to gate destructive commands. */
export function findCommand(port: ConsolePort, name: string): ConsoleCommandSpec | undefined {
  const wanted = name.trim().toLowerCase();
  return (CONSOLE_COMMANDS[port] ?? []).find((cmd) => isName(cmd, wanted));
}

/**
 * Whether the first token of `line` is a command flagged destructive on `port`.
 * Callers must confirm with the user before sending one.
 */
export function isDestructiveCommand(port: ConsolePort, line: string): boolean {
  const name = line.trim().split(/\s+/)[0] ?? '';
  return findCommand(port, name)?.destructive === true;
}

function isName(cmd: ConsoleCommandSpec, name: string): boolean {
  return cmd.name === name || (cmd.aliases?.includes(name) ?? false);
}

function matchesPrefix(cmd: ConsoleCommandSpec, prefix: string): boolean {
  if (prefix === '') return true;
  if (cmd.name.startsWith(prefix)) return true;
  return cmd.aliases?.some((alias) => alias.startsWith(prefix)) ?? false;
}
