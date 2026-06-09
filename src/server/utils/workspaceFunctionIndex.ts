import * as path from 'path';
import fsWrapper from './fsWrapper';
import { parseFunctionDefs, FunctionDefinition } from '../brightscript/functionIndex';

/**
 * A workspace-wide index of function/sub definitions from all .brs files.
 * Built once at startup and updated incrementally when files change.
 *
 * Eliminates the need for full workspace scans on every Find References
 * or Rename request.
 */
export class WorkspaceFunctionIndex {
  /** Maps file path → array of function definitions. */
  private _fileIndex = new Map<string, FunctionDefinition[]>();
  /** All function names (lowercase) for quick membership checks. */
  private _allNames = new Set<string>();

  /**
   * Builds the index by scanning all .brs files under the given roots.
   * Skips hidden directories and node_modules.
   */
  build(roots: string[]): void {
    this._fileIndex.clear();
    this._allNames.clear();
    for (const root of roots) {
      this._walkDir(root);
    }
  }

  /** Updates the index for a single file (after save/create). */
  updateFile(filePath: string): void {
    if (!filePath.endsWith('.brs')) return;
    // Remove old entries
    const old = this._fileIndex.get(filePath);
    if (old) {
      for (const def of old) this._allNames.delete(def.nameLower);
    }

    try {
      const text = fsWrapper.readFileSync(filePath, 'utf-8');
      const defs = parseFunctionDefs(text, filePath);
      this._fileIndex.set(filePath, defs);
      for (const def of defs) this._allNames.add(def.nameLower);
    } catch {
      this._fileIndex.delete(filePath);
    }
  }

  /** Removes a file from the index (after delete). */
  removeFile(filePath: string): void {
    const old = this._fileIndex.get(filePath);
    if (old) {
      for (const def of old) this._allNames.delete(def.nameLower);
      this._fileIndex.delete(filePath);
    }
  }

  /** Returns all indexed file paths. */
  getFiles(): IterableIterator<string> {
    return this._fileIndex.keys();
  }

  /** Returns function definitions for a specific file. */
  getFileFunctions(filePath: string): FunctionDefinition[] {
    return this._fileIndex.get(filePath) ?? [];
  }

  /** Returns all function definitions across the workspace. */
  getAllFunctions(): FunctionDefinition[] {
    const all: FunctionDefinition[] = [];
    for (const defs of this._fileIndex.values()) {
      all.push(...defs);
    }
    return all;
  }

  /** Reads a file's text from the index cache (avoids re-reading from disk). */
  readFileText(filePath: string): string | undefined {
    try {
      return fsWrapper.readFileSync(filePath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /** Number of indexed files. */
  get fileCount(): number {
    return this._fileIndex.size;
  }

  private _walkDir(dir: string): void {
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
        this._walkDir(full);
      } else if (entry.name.endsWith('.brs')) {
        try {
          const text = fsWrapper.readFileSync(full, 'utf-8');
          const defs = parseFunctionDefs(text, full);
          this._fileIndex.set(full, defs);
          for (const def of defs) this._allNames.add(def.nameLower);
        } catch { /* skip unreadable */ }
      }
    }
  }
}
