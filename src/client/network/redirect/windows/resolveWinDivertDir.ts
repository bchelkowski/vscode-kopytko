/**
 * Decides which WinDivert install the companion should use. Pure and
 * unit-tested — `activation/network.ts` supplies the real config value,
 * `process.arch`, the extension's bundled path, and a real `fs` check.
 *
 * The extension ships the official x64 WinDivert redistributable
 * (`resources/win/x64/`, see its README for provenance/license), so the
 * common case needs zero setup: no download, no settings. Windivert
 * `kopytko.network.winDivertDir` only exists as an escape hatch — a
 * different WinDivert build/version, or a non-x64 architecture the bundled
 * binaries can't cover.
 */

export interface ResolveWinDivertDirOptions {
  /** `kopytko.network.winDivertDir`, already trimmed. Empty string when unset. */
  configuredDir: string;
  /** `process.arch` of this machine. */
  arch: string;
  /** The extension's own bundled x64 WinDivert directory. */
  bundledDir: string;
  /** True if `dir` contains both WinDivert.dll and WinDivert64.sys. Injectable for tests. */
  hasWinDivertFiles: (dir: string) => boolean;
}

export type ResolveWinDivertDirResult =
  | { ok: true; dir: string; source: 'configured' | 'bundled' }
  | { ok: false; reason: string };

export function resolveWinDivertDir(opts: ResolveWinDivertDirOptions): ResolveWinDivertDirResult {
  if (opts.configuredDir) {
    if (opts.hasWinDivertFiles(opts.configuredDir)) {
      return { ok: true, dir: opts.configuredDir, source: 'configured' };
    }
    return {
      ok: false,
      reason:
        `"kopytko.network.winDivertDir" is set to "${opts.configuredDir}", but WinDivert.dll ` +
        'and WinDivert64.sys were not found there. Check the path, or clear the setting to use ' +
        'the version bundled with this extension.',
    };
  }

  if (opts.arch !== 'x64') {
    return {
      ok: false,
      reason:
        `The WinDivert driver bundled with this extension only supports 64-bit Windows (x64) — ` +
        `this machine reports "${opts.arch}". Download a matching WinDivert build from ` +
        'https://reqrypt.org/windivert.html and set "kopytko.network.winDivertDir" to it.',
    };
  }

  if (opts.hasWinDivertFiles(opts.bundledDir)) {
    return { ok: true, dir: opts.bundledDir, source: 'bundled' };
  }

  return {
    ok: false,
    reason:
      'The WinDivert driver bundled with this extension is missing or unreadable — try ' +
      'reinstalling the extension, or set "kopytko.network.winDivertDir" to a manual WinDivert ' +
      'install (https://reqrypt.org/windivert.html).',
  };
}
