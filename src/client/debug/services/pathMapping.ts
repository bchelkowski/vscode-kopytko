import * as path from 'path';

/** Maps a Roku runtime path (pkg:/components/Foo.brs) to a local absolute path. */
export function rokuPathToLocal(rokuPath: string, rootDir: string): string {
  const relative = rokuPath.replace(/^\/pkg:\//i, '').replace(/^pkg:\//i, '');
  return path.join(rootDir, relative);
}

/** Maps a local absolute path to a Roku pkg:/ path. */
export function localPathToRoku(localPath: string, rootDir: string): string {
  const relative = path.relative(rootDir, localPath).replace(/\\/g, '/');
  return `pkg:/${relative}`;
}
