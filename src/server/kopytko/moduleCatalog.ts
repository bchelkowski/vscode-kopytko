import fsWrapper from '../utils/fsWrapper';
import { parseFunctionDefs } from '../brightscript/functionIndex';
import { KopytkoImportResolver } from './importResolver';
import { walkTree } from '../utils/dirWalker';

/** A single exported function or sub discovered in an installed Kopytko package. */
export interface KopytkoExportEntry {
  /** Function/sub name as it appears in source (original casing). */
  name: string;
  /** Full declaration line, e.g. `function setState(newState as Object)`. */
  signature: string;
  /** Import path relative to the package base dir, e.g. `/Renderer.brs`. */
  importPath: string;
  /** NPM package name, e.g. `@dazn/kopytko-framework`. */
  npmPackage: string;
}

/**
 * Scans installed Kopytko NPM packages and builds an in-memory index of every
 * exported function/sub. Replaces the old static KOPYTKO_MODULES catalog.
 *
 * Call `scan()` once at server startup and again whenever the configuration
 * changes (e.g. `resolveModules` or workspace folders).
 */
export class KopytkoModuleCatalog {
  private _entries: KopytkoExportEntry[] = [];
  private _lookupMap = new Map<string, KopytkoExportEntry>();
  private _sourceDirNamesCache: Set<string> | null = null;

  /**
   * Rebuilds the catalog by walking all Kopytko packages visible from rootPath.
   * Existing entries are discarded and replaced.
   */
  scan(rootPath: string, importResolver: KopytkoImportResolver): void {
    this._entries = [];
    this._lookupMap = new Map();
    this._sourceDirNamesCache = null;
    const packages = importResolver.getInstalledKopytkoPackages(rootPath);
    for (const pkg of packages) {
      const baseDir = importResolver.resolvePackageBaseDir(pkg, rootPath);
      if (!baseDir) continue;
      walkTree(baseDir, (filePath, entryName) => {
        if (!entryName.endsWith('.brs')) return;
        let text: string;
        try {
          text = fsWrapper.readFileSync(filePath, 'utf-8');
        } catch {
          return;
        }
        const rel = filePath.slice(baseDir.length).replace(/\\/g, '/');
        const importPath = rel.startsWith('/') ? rel : '/' + rel;
        for (const def of parseFunctionDefs(text, filePath)) {
          const entry: KopytkoExportEntry = {
            name: def.name,
            signature: def.signature,
            importPath,
            npmPackage: pkg,
          };
          this._entries.push(entry);
          const lower = def.name.toLowerCase();
          if (!this._lookupMap.has(lower)) this._lookupMap.set(lower, entry);
        }
      }, { skipNodeModules: false });
    }
  }

  /** Case-insensitive lookup by function/sub name. Returns the first match. */
  findExport(name: string): KopytkoExportEntry | undefined {
    return this._lookupMap.get(name.toLowerCase());
  }

  /**
   * Returns a set of function/sub names (lowercase) from Kopytko module source/
   * directories. These are globally accessible at runtime without @import.
   */
  getSourceDirNamesLower(): Set<string> {
    if (!this._sourceDirNamesCache) {
      this._sourceDirNamesCache = new Set(
        this._entries
          .filter((e) => e.importPath.startsWith('/source/'))
          .map((e) => e.name.toLowerCase()),
      );
    }
    return this._sourceDirNamesCache;
  }

  /** Number of catalogued entries. */
  get size(): number {
    return this._entries.length;
  }

  /** Returns all catalogued entries (for completion provider). */
  getEntries(): readonly KopytkoExportEntry[] {
    return this._entries;
  }
}
