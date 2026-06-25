/**
 * Minimal browser-compatible path stub.
 * Only the subset used by the linter and formatter packages.
 */
const normalise = (p: string) => p.replace(/\\/g, '/');

export const sep = '/';

export function basename(p: string, ext?: string): string {
  const base = normalise(p).split('/').pop() ?? '';
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function dirname(p: string): string {
  const n = normalise(p);
  const i = n.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0)  return '/';
  return n.slice(0, i);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
}

export function join(...parts: string[]): string {
  return normalise(parts.filter(Boolean).join('/'));
}

export function resolve(...parts: string[]): string {
  return normalise(parts.filter(Boolean).join('/'));
}

export function relative(_from: string, to: string): string {
  return normalise(to);
}

export function normalize(p: string): string {
  return normalise(p);
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export default {
  sep, basename, dirname, extname, join, resolve, relative, normalize, isAbsolute,
};
