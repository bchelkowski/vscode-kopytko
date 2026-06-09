import * as path from 'path';
import fsWrapper from '../utils/fsWrapper';

/** A parsed @import annotation from a .brs file. */
export interface KopytkoImport {
  /** Original annotation line, e.g. `' @import /components/foo.brs from @kopytko/utils` */
  raw: string;
  /** The resolved import path, e.g. `/components/foo.brs` */
  importPath: string;
  /** NPM package name when it's an external dependency, e.g. `@kopytko/utils`. Undefined for internal imports. */
  fromModule?: string;
  /** 1-based line number of the annotation in the source file. */
  line: number;
  /** Whether this is an @mock annotation (vs @import). */
  isMock?: boolean;
}

export interface ImportResolverOptions {
  workspaceFolders: string[];
  /** Source directory relative to workspace root (matches .kopytkorc `sourceDir`). Default: `app` */
  sourceDir: string;
  /** Whether to resolve imports from installed NPM kopytko-module packages. */
  resolveModules: boolean;
}

/**
 * Parses and resolves Kopytko `@import` annotations in BrightScript files.
 *
 * Supported syntax:
 *   ' @import /path/to/file.brs
 *   ' @import /path/to/file.brs from @package/name
 */
export class KopytkoImportResolver {
  private static readonly IMPORT_PATTERN =
    /^\s*'\s*@(import|mock)\s+(\S+)(?:\s+from\s+(\S+))?\s*$/;

  private _packageCache: string[] | null = null;
  private _baseDirCache = new Map<string, string | undefined>();

  constructor(private readonly options: ImportResolverOptions) {}

  getWorkspaceFolders(): string[] { return this.options.workspaceFolders; }
  getSourceDir(): string { return this.options.sourceDir; }

  /** Clears cached package list and base dir lookups (call on file system changes). */
  invalidatePackageCache(): void {
    this._packageCache = null;
    this._baseDirCache.clear();
  }

  /**
   * Returns the base directory to use for `@import` path completions when the
   * annotation has a `from <packageName>` clause.  Looks for
   * `<root>/node_modules/<packageName>/<kopytkoModuleDir>`.
   *
   * Tries workspace folders first (most common), then walks up from `documentPath`.
   * Returns `undefined` when module resolution is disabled or the package is not
   * found.
   */
  resolvePackageBaseDir(packageName: string, documentPath: string): string | undefined {
    if (!this.options.resolveModules) return undefined;

    const cacheKey = `${packageName}|${documentPath}`;
    if (this._baseDirCache.has(cacheKey)) return this._baseDirCache.get(cacheKey);

    const tryModulePath = (modulePath: string): string | undefined => {
      if (!fsWrapper.existsSync(modulePath)) return undefined;
      const kopytkoDir = this.readKopytkoModuleDir(modulePath);
      return kopytkoDir ? path.join(modulePath, kopytkoDir) : modulePath;
    };

    for (const wsFolder of this.options.workspaceFolders) {
      const result = tryModulePath(path.join(wsFolder, 'node_modules', packageName));
      if (result) { this._baseDirCache.set(cacheKey, result); return result; }
    }

    let dir = path.dirname(documentPath);
    const maxDepth = 10;
    for (let i = 0; i < maxDepth; i++) {
      const result = tryModulePath(path.join(dir, 'node_modules', packageName));
      if (result) { this._baseDirCache.set(cacheKey, result); return result; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    this._baseDirCache.set(cacheKey, undefined);
    return undefined;
  }

  /**
   * Scans `node_modules` directories visible from documentPath and returns the
   * names of every package whose `package.json` declares a `kopytkoModuleDir`
   * field — the marker that identifies a Kopytko module.
   *
   * Searches workspace folder roots first, then walks up from documentPath
   * (same strategy as resolvePackageBaseDir). Duplicate package names are
   * deduplicated; the result is sorted alphabetically.
   */
  getInstalledKopytkoPackages(documentPath: string): string[] {
    if (!this.options.resolveModules) return [];
    if (this._packageCache) return this._packageCache;

    const packages = new Set<string>();
    const scannedDirs = new Set<string>();

    const scanNodeModules = (nmDir: string): void => {
      if (scannedDirs.has(nmDir)) return;
      scannedDirs.add(nmDir);

      let topEntries: ReturnType<typeof fsWrapper.readdirTyped>;
      try {
        topEntries = fsWrapper.readdirTyped(nmDir);
      } catch {
        return;
      }

      for (const entry of topEntries) {
        if (!entry.isDirectory) continue;
        if (entry.name.startsWith('@')) {
          // Scoped package — one extra directory level (@scope/pkgname)
          let scopedEntries: ReturnType<typeof fsWrapper.readdirTyped>;
          try {
            scopedEntries = fsWrapper.readdirTyped(path.join(nmDir, entry.name));
          } catch {
            continue;
          }
          for (const scoped of scopedEntries) {
            if (!scoped.isDirectory) continue;
            const pkgName = `${entry.name}/${scoped.name}`;
            if (this.hasKopytkoModuleDir(path.join(nmDir, entry.name, scoped.name))) {
              packages.add(pkgName);
            }
          }
        } else {
          if (this.hasKopytkoModuleDir(path.join(nmDir, entry.name))) {
            packages.add(entry.name);
          }
        }
      }
    };

    for (const ws of this.options.workspaceFolders) {
      scanNodeModules(path.join(ws, 'node_modules'));
    }

    let dir = path.dirname(documentPath);
    const maxDepth = 10;
    for (let i = 0; i < maxDepth; i++) {
      scanNodeModules(path.join(dir, 'node_modules'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    this._packageCache = [...packages].sort();
    return this._packageCache;
  }

  /**
   * Extract all @import annotations from a .brs file's text content.
   */
  parseImports(text: string): KopytkoImport[] {
    const lines = text.split(/\r?\n/);
    const imports: KopytkoImport[] = [];

    for (let i = 0; i < lines.length; i++) {
      const match = KopytkoImportResolver.IMPORT_PATTERN.exec(lines[i]);
      if (match) {
        imports.push({
          raw: lines[i].trim(),
          importPath: match[2],
          fromModule: match[3],
          line: i + 1,
          isMock: match[1] === 'mock',
        });
      }
    }

    return imports;
  }

  /**
   * Attempt to resolve the absolute filesystem path for a given import.
   * Returns `undefined` if the file cannot be located.
   */
  resolveImportPath(importEntry: KopytkoImport, documentPath: string): string | undefined {
    if (importEntry.fromModule) {
      return this.resolveExternalImport(importEntry, documentPath);
    }
    return this.resolveInternalImport(importEntry, documentPath);
  }

  /**
   * Check whether a resolved import path actually exists on disk.
   */
  importExists(resolvedPath: string): boolean {
    try {
      return fsWrapper.existsSync(resolvedPath);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveInternalImport(
    importEntry: KopytkoImport,
    documentPath: string
  ): string | undefined {
    // Try each workspace folder as a root, looking in <root>/<sourceDir><importPath>
    for (const wsFolder of this.options.workspaceFolders) {
      const candidate = path.join(wsFolder, this.options.sourceDir, importEntry.importPath);
      if (fsWrapper.existsSync(candidate)) {
        return candidate;
      }
      // Also try directly from workspace root (no sourceDir prefix)
      const candidateRoot = path.join(wsFolder, importEntry.importPath);
      if (fsWrapper.existsSync(candidateRoot)) {
        return candidateRoot;
      }
    }

    // If the document lives inside a node_modules package, resolve the import
    // relative to that package's kopytkoModuleDir root (handles internal @imports
    // in framework files like `' @import /components/utils/Core.brs`).
    const pkgRoot = getNodeModulesPackageRoot(documentPath);
    if (pkgRoot) {
      const kopytkoDir = this.readKopytkoModuleDir(pkgRoot);
      const candidate = path.join(pkgRoot, kopytkoDir, importEntry.importPath);
      if (fsWrapper.existsSync(candidate)) {
        return candidate;
      }
    }

    // Last resort: resolve relative to the document's directory
    const docDir = path.dirname(documentPath);
    const relative = path.join(docDir, importEntry.importPath);
    if (fsWrapper.existsSync(relative)) {
      return relative;
    }

    return undefined;
  }

  private resolveExternalImport(
    importEntry: KopytkoImport,
    documentPath: string
  ): string | undefined {
    if (!this.options.resolveModules || !importEntry.fromModule) {
      return undefined;
    }

    // Walk up from document to find node_modules
    let dir = path.dirname(documentPath);
    const maxDepth = 10;
    for (let i = 0; i < maxDepth; i++) {
      const modulePath = path.join(dir, 'node_modules', importEntry.fromModule);
      if (fsWrapper.existsSync(modulePath)) {
        // Determine sub-directory from package.json `kopytkoModuleDir` if present
        const kopytkoDir = this.readKopytkoModuleDir(modulePath);
        const candidate = path.join(modulePath, kopytkoDir, importEntry.importPath);
        if (fsWrapper.existsSync(candidate)) {
          return candidate;
        }
        // Also try without the subdir
        const candidateRoot = path.join(modulePath, importEntry.importPath);
        if (fsWrapper.existsSync(candidateRoot)) {
          return candidateRoot;
        }
        return undefined; // module found but file not found inside it
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    return undefined;
  }

  /** Returns true when the package at pkgPath has a `kopytkoModuleDir` key in its package.json. */
  private hasKopytkoModuleDir(pkgPath: string): boolean {
    try {
      const content = fsWrapper.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8');
      const pkg = JSON.parse(content) as Record<string, unknown>;
      return 'kopytkoModuleDir' in pkg;
    } catch {
      return false;
    }
  }

  /** Read `kopytkoModuleDir` from a package's package.json if it exists. */
  readKopytkoModuleDir(modulePath: string): string {
    try {
      const pkgJson = path.join(modulePath, 'package.json');
      const content = fsWrapper.readFileSync(pkgJson, 'utf-8');
      const pkg = JSON.parse(content) as { kopytkoModuleDir?: string };
      return pkg.kopytkoModuleDir ?? '';
    } catch {
      return '';
    }
  }
}

/**
 * Given any path that lives inside a node_modules package, returns the package
 * root directory (handles both regular and scoped packages).
 *
 * e.g. `/proj/node_modules/@dazn/kopytko-framework/src/Foo.brs`
 *      → `/proj/node_modules/@dazn/kopytko-framework`
 */
export function getNodeModulesPackageRoot(filePath: string): string | undefined {
  const marker = `${path.sep}node_modules${path.sep}`;
  const idx = filePath.lastIndexOf(marker);
  if (idx === -1) return undefined;
  const base = filePath.slice(0, idx + marker.length);
  const after = filePath.slice(base.length);
  const parts = after.split(path.sep).filter(Boolean);
  if (parts.length === 0) return undefined;
  const pkgName = parts[0].startsWith('@') && parts.length >= 2
    ? parts[0] + path.sep + parts[1]
    : parts[0];
  return base + pkgName;
}
