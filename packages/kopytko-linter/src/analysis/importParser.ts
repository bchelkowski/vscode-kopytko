import * as nodePath from 'path';
import type { KopytkoImport } from '../types';
import fsWrapper from './fsWrapper';

const IMPORT_PATTERN = /^\s*'\s*@(import|mock)\s+(\S+)(?:\s+from\s+(\S+))?\s*$/;

export function parseImports(text: string): KopytkoImport[] {
  const lines = text.split(/\r?\n/);
  const imports: KopytkoImport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = IMPORT_PATTERN.exec(lines[i]);
    if (!match) continue;

    imports.push({
      raw: lines[i],
      importPath: match[2],
      fromModule: match[3] || undefined,
      line: i + 1,
      isMock: match[1] === 'mock',
    });
  }

  return imports;
}

export interface ImportResolverOptions {
  workspaceFolders: string[];
  sourceDir: string;
  resolveModules: boolean;
}

export class ImportResolver {
  private readonly options: ImportResolverOptions;
  private packageCache: Map<string, string> | null = null;

  constructor(options: ImportResolverOptions) {
    this.options = options;
  }

  getWorkspaceFolders(): string[] {
    return this.options.workspaceFolders;
  }

  getSourceDir(): string {
    return this.options.sourceDir;
  }

  parseImports(text: string): KopytkoImport[] {
    return parseImports(text);
  }

  resolveImportPath(imp: KopytkoImport, documentPath: string): string | undefined {
    if (imp.fromModule) {
      return this.resolveExternalImport(imp.importPath, imp.fromModule);
    }
    return this.resolveInternalImport(imp.importPath, documentPath);
  }

  importExists(imp: KopytkoImport, documentPath: string): boolean {
    return this.resolveImportPath(imp, documentPath) !== undefined;
  }

  invalidatePackageCache(): void {
    this.packageCache = null;
  }

  private resolveInternalImport(importPath: string, documentPath: string): string | undefined {
    const { workspaceFolders, sourceDir } = this.options;

    // Try workspace folders
    for (const folder of workspaceFolders) {
      const withSource = nodePath.join(folder, sourceDir, importPath);
      if (fsWrapper.existsSync(withSource)) return withSource;

      const direct = nodePath.join(folder, importPath);
      if (fsWrapper.existsSync(direct)) return direct;
    }

    // Try relative to document
    const relative = nodePath.resolve(nodePath.dirname(documentPath), importPath);
    if (fsWrapper.existsSync(relative)) return relative;

    return undefined;
  }

  private resolveExternalImport(importPath: string, moduleName: string): string | undefined {
    if (!this.options.resolveModules) return undefined;

    const packageRoot = this.resolvePackageBaseDir(moduleName);
    if (!packageRoot) return undefined;

    const fullPath = nodePath.join(packageRoot, importPath);
    if (fsWrapper.existsSync(fullPath)) return fullPath;

    return undefined;
  }

  resolvePackageBaseDir(packageName: string): string | undefined {
    if (!this.packageCache) {
      this.packageCache = new Map();
      for (const folder of this.options.workspaceFolders) {
        const nodeModulesPath = nodePath.join(folder, 'node_modules', packageName);
        if (fsWrapper.existsSync(nodeModulesPath)) {
          this.packageCache.set(packageName, nodeModulesPath);
          break;
        }
      }
    }
    return this.packageCache.get(packageName);
  }
}
