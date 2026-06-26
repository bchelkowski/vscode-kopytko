import * as fs from 'fs';
import * as path from 'path';

/** Directory entry returned by {@link DiagnosticsSink.readdir}. */
export interface SinkDirEntry {
  name: string;
  isDirectory: boolean;
}

/**
 * Minimal async filesystem surface used by the diagnostics storage layer.
 * Injectable so tests run entirely in-memory and never touch real disk.
 */
export interface DiagnosticsSink {
  ensureDir(dir: string): Promise<void>;
  appendFile(file: string, data: string): Promise<void>;
  writeFile(file: string, data: string): Promise<void>;
  readFile(file: string): Promise<string>;
  readdir(dir: string): Promise<SinkDirEntry[]>;
  exists(target: string): Promise<boolean>;
}

/** Default sink backed by the Node filesystem. */
export const nodeSink: DiagnosticsSink = {
  async ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  },
  async appendFile(file, data) {
    await fs.promises.appendFile(file, data, 'utf-8');
  },
  async writeFile(file, data) {
    await fs.promises.writeFile(file, data, 'utf-8');
  },
  async readFile(file) {
    return fs.promises.readFile(file, 'utf-8');
  },
  async readdir(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  },
  async exists(target) {
    try {
      await fs.promises.access(target);
      return true;
    } catch {
      return false;
    }
  },
};

/** Joins path segments (re-exported so callers don't import `path` directly). */
export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}
