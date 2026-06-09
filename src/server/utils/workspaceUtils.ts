import * as nodePath from 'path';
import { KopytkoImportResolver } from '../kopytko/importResolver';

/**
 * Builds the list of directories that should be searched when looking up
 * a component's XML file: workspace source dirs + installed Kopytko
 * package base directories.
 */
export function buildSearchRoots(
  importResolver: KopytkoImportResolver,
  documentPath: string,
): string[] {
  const roots: string[] = [];
  for (const ws of importResolver.getWorkspaceFolders()) {
    roots.push(nodePath.join(ws, importResolver.getSourceDir()));
    roots.push(ws);
  }
  for (const pkg of importResolver.getInstalledKopytkoPackages(documentPath)) {
    const base = importResolver.resolvePackageBaseDir(pkg, documentPath);
    if (base) roots.push(base);
  }
  return roots;
}
