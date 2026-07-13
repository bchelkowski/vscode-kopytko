/**
 * The concrete privileged command runner used in production. Writes the batch
 * of commands to an auditable shell script under the extension's storage dir,
 * then runs it with an OS credential prompt (macOS GUI dialog / Linux pkexec).
 * macOS/Linux only — this tool has no Windows redirect to elevate.
 *
 * Kept separate from `RedirectController` so the controller can be unit-tested
 * with an injected fake runner that never touches the host.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ElevatedRunner } from './redirectController';

export function createElevatedRunner(scriptDir: string, log?: (msg: string) => void): ElevatedRunner {
  return (label: string, commands: string[]): Promise<void> => {
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, `redirect-${sanitize(label)}.sh`);
    // `set -e` makes any failing command abort with a non-zero exit so the
    // failure actually propagates (instead of a later `|| true` masking it).
    const script = ['#!/bin/sh', 'set -e', `# ${label}`, ...commands, ''].join('\n');
    fs.writeFileSync(scriptPath, script, { mode: 0o700 });

    log?.(`${label}\n  script: ${scriptPath}\n  ${commands.join('\n  ')}`);

    const invocation = buildElevatedInvocation(process.platform, scriptPath, label);
    if (!invocation) {
      return Promise.reject(new Error(`No elevation strategy for platform ${process.platform}`));
    }

    return new Promise((resolve, reject) => {
      execFile(invocation.cmd, invocation.args, (err, _stdout, stderr) => {
        if (err) {
          const detail = stderr?.trim() || err.message;
          log?.(`FAILED: ${detail}`);
          reject(new Error(detail));
          return;
        }
        resolve();
      });
    });
  };
}

export interface ElevatedInvocation {
  cmd: string;
  args: string[];
}

/**
 * Builds the argv used to run `scriptPath` elevated — deliberately an argv
 * array for `execFile`, never a hand-built shell string for `exec`. A shell
 * string requires manually nesting quotes around `scriptPath`, and VS Code's
 * `globalStorageUri` on macOS lives under `~/Library/Application Support/…` —
 * the space there broke an earlier single-quoted version of this (the shell
 * word-split the path mid-argument, truncating the AppleScript and producing
 * "syntax error: Expected string but found end of script"). `execFile` passes
 * each argv element byte-for-byte with no shell involved, so spaces/quotes in
 * `scriptPath` or `label` can't corrupt anything at this layer.
 *
 * Exported for unit testing.
 */
export function buildElevatedInvocation(
  platform: NodeJS.Platform,
  scriptPath: string,
  label: string,
): ElevatedInvocation | null {
  if (platform === 'darwin') {
    // `do shell script` itself spawns an inner shell, so the path still needs
    // shell-safe quoting there — `quoted form of` computes that robustly at
    // AppleScript runtime (handles spaces/quotes we can't predict here).
    const appleScript =
      `do shell script "/bin/sh " & quoted form of "${escapeAppleScript(scriptPath)}" ` +
      `with prompt "${escapeAppleScript(label)}" with administrator privileges`;
    return { cmd: 'osascript', args: ['-e', appleScript] };
  }
  if (platform === 'linux') {
    // pkexec takes argv directly (no shell), so the path needs no quoting at all.
    return { cmd: 'pkexec', args: ['/bin/sh', scriptPath] };
  }
  return null;
}

function escapeAppleScript(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'batch';
}
