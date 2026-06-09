import * as path from 'path';
import fsWrapper from './fsWrapper';

/**
 * Recursively walks a directory tree, calling `callback` for every `.brs` file.
 * Skips hidden directories (`.` prefix) and `node_modules`.
 */
export function collectBrsFiles(dir: string, callback: (filePath: string) => void): void {
  let entries: ReturnType<typeof fsWrapper.readdirTyped>;
  try {
    entries = fsWrapper.readdirTyped(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory) {
      collectBrsFiles(full, callback);
    } else if (entry.name.endsWith('.brs')) {
      callback(full);
    }
  }
}
