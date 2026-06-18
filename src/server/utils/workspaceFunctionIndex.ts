import * as path from 'path';
import fsWrapper from './fsWrapper';
import { FunctionDefinition } from '../brightscript/functionIndex';
import {
  getCachedFunctionDefs,
  invalidateFileParseCache,
  clearFileParseCache,
} from './fileParseCache';

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

  // Lazily-built caches for source/ directory functions.
  // Cleared whenever a file in a source/ directory is added, updated, or removed.
  private _sourceDirNamesCache: Set<string> | null = null;
  private _sourceDirFunctionsCache: FunctionDefinition[] | null = null;
  private _sourceDirMapCache: Map<string, FunctionDefinition> | null = null;

  /**
   * Builds the index by scanning all .brs files under the given roots.
   * Skips hidden directories and node_modules.
   */
  build(roots: string[]): void {
    this._fileIndex.clear();
    this._allNames.clear();
    this._clearSourceDirCache();
    clearFileParseCache();
    for (const root of roots) {
      this._walkDir(root);
    }
  }

  /** Updates the index for a single file (after save/create). */
  updateFile(filePath: string): void {
    if (!filePath.endsWith('.brs')) return;
    if (filePath.replace(/\\/g, '/').includes('/source/')) this._clearSourceDirCache();
    // Remove old entries
    const old = this._fileIndex.get(filePath);
    if (old) {
      for (const def of old) this._allNames.delete(def.nameLower);
    }

    // Evict any stale cached text/parse, then re-read via the shared cache so
    // the fresh read is memoized for References/Rename and the collectors.
    invalidateFileParseCache(filePath);
    const defs = getCachedFunctionDefs(filePath);
    if (defs) {
      this._fileIndex.set(filePath, defs);
      for (const def of defs) this._allNames.add(def.nameLower);
    } else {
      this._fileIndex.delete(filePath);
    }
  }

  /** Removes a file from the index (after delete). */
  removeFile(filePath: string): void {
    if (filePath.replace(/\\/g, '/').includes('/source/')) this._clearSourceDirCache();
    invalidateFileParseCache(filePath);
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

  /** Number of indexed files. */
  get fileCount(): number {
    return this._fileIndex.size;
  }

  /** Names (lowercase) of functions defined in source/ directories. Cached. */
  getSourceDirNames(): Set<string> {
    if (!this._sourceDirNamesCache) this._buildSourceDirCache();
    return this._sourceDirNamesCache!;
  }

  /** Function definitions from source/ directories. Cached. */
  getSourceDirFunctions(): FunctionDefinition[] {
    if (!this._sourceDirFunctionsCache) this._buildSourceDirCache();
    return this._sourceDirFunctionsCache!;
  }

  /** O(1) lookup of a source/ function by lowercase name. Cached. */
  findSourceDirFunction(nameLower: string): FunctionDefinition | undefined {
    if (!this._sourceDirMapCache) {
      const map = new Map<string, FunctionDefinition>();
      for (const def of this.getSourceDirFunctions()) {
        if (!map.has(def.nameLower)) map.set(def.nameLower, def);
      }
      this._sourceDirMapCache = map;
    }
    return this._sourceDirMapCache.get(nameLower);
  }

  private _buildSourceDirCache(): void {
    const names = new Set<string>();
    const funcs: FunctionDefinition[] = [];
    for (const [filePath, defs] of this._fileIndex) {
      if (filePath.replace(/\\/g, '/').includes('/source/')) {
        for (const def of defs) {
          names.add(def.nameLower);
          funcs.push(def);
        }
      }
    }
    this._sourceDirNamesCache = names;
    this._sourceDirFunctionsCache = funcs;
    this._sourceDirMapCache = null;
  }

  private _clearSourceDirCache(): void {
    this._sourceDirNamesCache = null;
    this._sourceDirFunctionsCache = null;
    this._sourceDirMapCache = null;
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
        const defs = getCachedFunctionDefs(full);
        if (defs) {
          this._fileIndex.set(full, defs);
          for (const def of defs) this._allNames.add(def.nameLower);
        }
      }
    }
  }
}
