/**
 * Empty browser-compatible fs stub.
 * The linter uses fs only for reading config files and scanning the filesystem —
 * neither of which happens in the browser playground.
 */
export const existsSync = (_p: string): boolean => false;
export const readFileSync = (_p: string, _enc?: string): string => '';
export const writeFileSync = (_p: string, _d: string): void => {};
export const readdirSync = (_p: string): string[] => [];
export const mkdirSync = (_p: string, _o?: unknown): void => {};
export const statSync = (_p: string) => ({ isDirectory: () => false, isFile: () => true });
export const lstatSync = statSync;

export default {
  existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, lstatSync,
};
