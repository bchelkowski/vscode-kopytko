import * as path from 'path';
import fsWrapper from './fsWrapper';

export interface WalkTreeOptions {
  /** Skip `node_modules` directories in addition to dot-prefixed ones. Defaults to true. */
  skipNodeModules?: boolean;
}

/**
 * Recursively walks a directory tree, calling `onFile` for every non-directory
 * entry. Skips dot-prefixed directories, and `node_modules` unless
 * `skipNodeModules` is set to false (e.g. when walking inside an already-resolved
 * package directory where a nested `node_modules` should still be visited).
 */
export function walkTree(
  dir: string,
  onFile: (filePath: string, entryName: string) => void,
  opts: WalkTreeOptions = {},
): void {
  const skipNodeModules = opts.skipNodeModules ?? true;
  let entries: ReturnType<typeof fsWrapper.readdirTyped>;
  try {
    entries = fsWrapper.readdirTyped(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (skipNodeModules && entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory) {
      walkTree(full, onFile, opts);
    } else {
      onFile(full, entry.name);
    }
  }
}
