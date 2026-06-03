import * as path from 'path';
import { existsSync, readFileSync } from '../utils/fsWrapper';

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
    /^\s*'\s*@import\s+(\S+)(?:\s+from\s+(\S+))?\s*$/;

  constructor(private readonly options: ImportResolverOptions) {}

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
          importPath: match[1],
          fromModule: match[2],
          line: i + 1,
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
      return existsSync(resolvedPath);
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
      if (existsSync(candidate)) {
        return candidate;
      }
      // Also try directly from workspace root (no sourceDir prefix)
      const candidateRoot = path.join(wsFolder, importEntry.importPath);
      if (existsSync(candidateRoot)) {
        return candidateRoot;
      }
    }

    // Last resort: resolve relative to the document's directory
    const docDir = path.dirname(documentPath);
    const relative = path.join(docDir, importEntry.importPath);
    if (existsSync(relative)) {
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
      if (existsSync(modulePath)) {
        // Determine sub-directory from package.json `kopytkoModuleDir` if present
        const kopytkoDir = this.readKopytkoModuleDir(modulePath);
        const candidate = path.join(modulePath, kopytkoDir, importEntry.importPath);
        if (existsSync(candidate)) {
          return candidate;
        }
        // Also try without the subdir
        const candidateRoot = path.join(modulePath, importEntry.importPath);
        if (existsSync(candidateRoot)) {
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

  /** Read `kopytkoModuleDir` from a package's package.json if it exists. */
  private readKopytkoModuleDir(modulePath: string): string {
    try {
      const pkgJson = path.join(modulePath, 'package.json');
      const content = readFileSync(pkgJson, 'utf-8');
      const pkg = JSON.parse(content) as { kopytkoModuleDir?: string };
      return pkg.kopytkoModuleDir ?? '';
    } catch {
      return '';
    }
  }
}
