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
  private readonly existsCache = new Map<string, boolean>();
  private readonly resolveCache = new Map<string, string | undefined>();

  constructor(options: ImportResolverOptions) {
    this.options = options;
  }

  private cachedExists(filePath: string): boolean {
    const normalized = nodePath.normalize(filePath);
    let result = this.existsCache.get(normalized);
    if (result === undefined) {
      result = fsWrapper.existsSync(filePath);
      this.existsCache.set(normalized, result);
    }
    return result;
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
    // Cache key: importPath + fromModule + documentDir (resolution depends on where the file is)
    const docDir = nodePath.dirname(nodePath.normalize(documentPath));
    const cacheKey = `${imp.importPath}|${imp.fromModule ?? ''}|${docDir}`;
    const cached = this.resolveCache.get(cacheKey);
    if (cached !== undefined) return cached || undefined;

    const result = imp.fromModule
      ? this.resolveExternalImport(imp.importPath, imp.fromModule, documentPath)
      : this.resolveInternalImport(imp.importPath, documentPath);

    this.resolveCache.set(cacheKey, result ?? '');
    return result;
  }

  importExists(imp: KopytkoImport, documentPath: string): boolean {
    return this.resolveImportPath(imp, documentPath) !== undefined;
  }

  private resolveInternalImport(importPath: string, documentPath: string): string | undefined {
    const { workspaceFolders, sourceDir } = this.options;

    for (const folder of workspaceFolders) {
      const withSource = nodePath.join(folder, sourceDir, importPath);
      if (this.cachedExists(withSource)) return withSource;

      const direct = nodePath.join(folder, importPath);
      if (this.cachedExists(direct)) return direct;
    }

    const pkgRoot = getNodeModulesPackageRoot(documentPath);
    if (pkgRoot) {
      const kopytkoDir = readKopytkoModuleDir(pkgRoot);
      const candidate = nodePath.join(pkgRoot, kopytkoDir, importPath);
      if (this.cachedExists(candidate)) return candidate;
    }

    const relative = nodePath.resolve(nodePath.dirname(documentPath), importPath);
    if (this.cachedExists(relative)) return relative;

    return undefined;
  }

  private resolveExternalImport(importPath: string, moduleName: string, documentPath: string): string | undefined {
    if (!this.options.resolveModules) return undefined;

    let dir = nodePath.dirname(documentPath);
    const maxDepth = 10;
    for (let i = 0; i < maxDepth; i++) {
      const modulePath = nodePath.join(dir, 'node_modules', moduleName);
      if (this.cachedExists(modulePath)) {
        const kopytkoDir = readKopytkoModuleDir(modulePath);
        const candidate = nodePath.join(modulePath, kopytkoDir, importPath);
        if (this.cachedExists(candidate)) return candidate;

        const candidateRoot = nodePath.join(modulePath, importPath);
        if (this.cachedExists(candidateRoot)) return candidateRoot;

        return undefined;
      }
      const parent = nodePath.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    return undefined;
  }
}

/** Read `kopytkoModuleDir` from a package's package.json if it exists. */
function readKopytkoModuleDir(modulePath: string): string {
  try {
    const pkgJson = nodePath.join(modulePath, 'package.json');
    const content = fsWrapper.readFileSync(pkgJson, 'utf-8');
    const pkg = JSON.parse(content) as { kopytkoModuleDir?: string };
    return pkg.kopytkoModuleDir ?? '';
  } catch {
    return '';
  }
}

/**
 * Given any path inside a node_modules package, returns the package root
 * (handles both regular and scoped packages).
 */
function getNodeModulesPackageRoot(filePath: string): string | undefined {
  const marker = `${nodePath.sep}node_modules${nodePath.sep}`;
  const idx = filePath.lastIndexOf(marker);
  if (idx === -1) return undefined;
  const base = filePath.slice(0, idx + marker.length);
  const after = filePath.slice(base.length);
  const parts = after.split(nodePath.sep).filter(Boolean);
  if (parts.length === 0) return undefined;
  const pkgName = parts[0].startsWith('@') && parts.length >= 2
    ? parts[0] + nodePath.sep + parts[1]
    : parts[0];
  return base + pkgName;
}
