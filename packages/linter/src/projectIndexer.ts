import * as nodePath from 'path';
import * as fs from 'fs';
import type { KopytkoImport } from './types';
import type { LintContext } from './context';
import type { LinterConfig } from './config';
import { parseImports, ImportResolver } from './analysis/importParser';
import { parseFunctionDefs } from './analysis/functionIndex';
import { findSiblingFiles } from './analysis/patternSiblings';
import { findTestSiblings, isTestFile, isTestRelatedFile, resolveTestedFiles } from './analysis/testUtils';
import { getScriptPathsFromXml, parseXmlExtends, parseXmlComponentName } from './analysis/xmlParser';
import { matchesGlob } from './analysis/globMatcher';
import { TEST_FRAMEWORK_GLOBALS } from './catalog/testGlobals';
import fsWrapper from './analysis/fsWrapper';

export interface ProjectContextResult {
  context: LintContext;
  brsFiles: string[];
  fileContentsCache: Map<string, string>;
}

// ── Async walk + parallel read (used by lintProjectAsync / CLI) ──

async function walkAsync(dir: string): Promise<{ brsFiles: string[]; xmlFiles: string[] }> {
  const brsFiles: string[] = [];
  const xmlFiles: string[] = [];
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return { brsFiles, xmlFiles }; }
  const subdirPromises: Promise<{ brsFiles: string[]; xmlFiles: string[] }>[] = [];
  for (const entry of entries) {
    const fullPath = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      subdirPromises.push(walkAsync(fullPath));
    } else if (entry.name.endsWith('.brs')) {
      brsFiles.push(fullPath);
    } else if (entry.name.endsWith('.xml')) {
      xmlFiles.push(fullPath);
    }
  }
  for (const sub of await Promise.all(subdirPromises)) {
    brsFiles.push(...sub.brsFiles);
    xmlFiles.push(...sub.xmlFiles);
  }
  return { brsFiles, xmlFiles };
}

export async function buildProjectContextAsync(projectRoot: string, config: LinterConfig): Promise<ProjectContextResult> {
  const importResolver = new ImportResolver({
    workspaceFolders: [projectRoot],
    sourceDir: config.sourceDir,
    resolveModules: config.resolveModules,
  });
  const workspaceFolders = [projectRoot];
  const sourceDir = config.sourceDir;

  // Phase 1: Async walk project + kopytko packages
  const sourceRoot = nodePath.join(projectRoot, sourceDir);
  const walkRoot = fsWrapper.existsSync(sourceRoot) ? sourceRoot : projectRoot;
  const projectFiles = await walkAsync(walkRoot);

  // Scan kopytko packages for XML
  const packageXmlFiles: string[] = [];
  const packageBrsFiles: string[] = [];
  const nmDir = nodePath.join(projectRoot, 'node_modules');
  try {
    const nmEntries = await fs.promises.readdir(nmDir, { withFileTypes: true });
    const pkgPromises: Promise<void>[] = [];
    const scanPkg = async (pkgDir: string): Promise<void> => {
      const moduleDir = readKopytkoModuleDir(pkgDir);
      if (!moduleDir) return;
      const sub = await walkAsync(nodePath.join(pkgDir, moduleDir));
      packageXmlFiles.push(...sub.xmlFiles);
      packageBrsFiles.push(...sub.brsFiles);
    };
    for (const entry of nmEntries) {
      if (!entry.isDirectory()) continue;
      const fullPath = nodePath.join(nmDir, entry.name);
      if (entry.name.startsWith('@')) {
        try {
          const scopedEntries = await fs.promises.readdir(fullPath, { withFileTypes: true });
          for (const scoped of scopedEntries) {
            if (scoped.isDirectory()) pkgPromises.push(scanPkg(nodePath.join(fullPath, scoped.name)));
          }
        } catch { /* skip */ }
      } else {
        pkgPromises.push(scanPkg(fullPath));
      }
    }
    await Promise.all(pkgPromises);
  } catch { /* no node_modules */ }

  const allXmlFiles = [...projectFiles.xmlFiles, ...packageXmlFiles];
  const allBrsFilesForIndex = [...projectFiles.brsFiles, ...packageBrsFiles];
  const brsFiles = projectFiles.brsFiles; // only project files get linted

  // Phase 2: Parallel read all files
  const readResults = await Promise.all([
    ...brsFiles.map(f => fs.promises.readFile(f, 'utf-8').then(text => ({ path: f, text, type: 'brs' as const })).catch(() => null)),
    ...packageBrsFiles.map(f => fs.promises.readFile(f, 'utf-8').then(text => ({ path: f, text, type: 'pkg-brs' as const })).catch(() => null)),
    ...allXmlFiles.map(f => fs.promises.readFile(f, 'utf-8').then(text => ({ path: f, text, type: 'xml' as const })).catch(() => null)),
  ]);

  // Phase 3: Parse (synchronous, CPU-bound — fast)
  const fileContentsCache = new Map<string, string>();
  const fileFunctions = new Map<string, string[]>();
  const fileImports = new Map<string, KopytkoImport[]>();
  const componentNameToXml = new Map<string, string>();
  const xmlTextCache = new Map<string, string>();
  const brsToXmlParents = new Map<string, string[]>();

  for (const result of readResults) {
    if (!result) continue;
    const normalized = nodePath.normalize(result.path);
    fileContentsCache.set(normalized, result.text);

    if (result.type === 'brs' || result.type === 'pkg-brs') {
      fileFunctions.set(normalized, parseFunctionDefs(result.text, result.path).map(f => f.nameLower));
      if (result.type === 'brs') {
        fileImports.set(normalized, parseImports(result.text));
      }
    } else {
      xmlTextCache.set(normalized, result.text);
      const name = parseXmlComponentName(result.text);
      if (name) componentNameToXml.set(name.toLowerCase(), normalized);
    }
  }

  // Pre-seed resolver cache
  importResolver.registerKnownPaths(allBrsFilesForIndex);
  importResolver.registerKnownPaths(allXmlFiles);
  // Register node_modules package directories
  try {
    const nmEntries = await fs.promises.readdir(nmDir, { withFileTypes: true });
    for (const entry of nmEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('@')) {
        try {
          const scopedEntries = await fs.promises.readdir(nodePath.join(nmDir, entry.name), { withFileTypes: true });
          for (const scoped of scopedEntries) {
            if (scoped.isDirectory()) importResolver.registerKnownPaths([nodePath.join(nmDir, entry.name, scoped.name)]);
          }
        } catch { /* skip */ }
      } else {
        importResolver.registerKnownPaths([nodePath.join(nmDir, entry.name)]);
      }
    }
  } catch { /* skip */ }

  // Build BRS→XML parent mapping
  for (const [xmlPath, xmlText] of xmlTextCache) {
    const scriptPaths = getScriptPathsFromXml(xmlPath, xmlText, workspaceFolders, sourceDir, (p) => importResolver.cachedExists(p));
    for (const scriptPath of scriptPaths) {
      const normalizedScript = nodePath.normalize(scriptPath);
      const parents = brsToXmlParents.get(normalizedScript) ?? [];
      parents.push(xmlPath);
      brsToXmlParents.set(normalizedScript, parents);
    }
  }

  // Phase 4: Build per-file known functions (reuse shared logic)
  return buildKnownFunctions({
    importResolver, workspaceFolders, sourceDir, brsFiles,
    fileContentsCache, fileFunctions, fileImports,
    componentNameToXml, xmlTextCache, brsToXmlParents,
    linterConfig: config,
  });
}

export function buildProjectContext(projectRoot: string, config: LinterConfig): ProjectContextResult {
  const importResolver = new ImportResolver({
    workspaceFolders: [projectRoot],
    sourceDir: config.sourceDir,
    resolveModules: config.resolveModules,
  });

  const workspaceFolders = [projectRoot];
  const sourceDir = config.sourceDir;

  // ── Phase 1: Scan all BRS and XML files (project + packages, single pass) ──
  // Also read file contents during the walk to avoid re-reading later.
  const brsFiles: string[] = [];
  const allKnownPaths: string[] = [];  // every file found during walk — pre-seeds existsSync cache
  const fileContentsCache = new Map<string, string>();
  const fileFunctions = new Map<string, string[]>();
  const fileImports = new Map<string, KopytkoImport[]>();
  const componentNameToXml = new Map<string, string>();
  const xmlTextCache = new Map<string, string>();
  const brsToXmlParents = new Map<string, string[]>();

  function walkAndIndex(dir: string, collectBrs: boolean): void {
    let entries;
    try { entries = fsWrapper.readdirTyped(dir); } catch { return; }
    for (const entry of entries) {
      const fullPath = nodePath.join(dir, entry.name);
      if (entry.isDirectory) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walkAndIndex(fullPath, collectBrs);
      } else if (entry.name.endsWith('.brs')) {
        allKnownPaths.push(fullPath);
        if (collectBrs) {
          brsFiles.push(fullPath);
          // Read + parse BRS in the same pass
          try {
            const text = fsWrapper.readFileSync(fullPath, 'utf-8');
            const normalized = nodePath.normalize(fullPath);
            fileContentsCache.set(normalized, text);
            fileFunctions.set(normalized, parseFunctionDefs(text, fullPath).map(f => f.nameLower));
            fileImports.set(normalized, parseImports(text));
          } catch { /* skip */ }
        }
      } else if (entry.name.endsWith('.xml')) {
        allKnownPaths.push(fullPath);
        try {
          const text = fsWrapper.readFileSync(fullPath, 'utf-8');
          const normalized = nodePath.normalize(fullPath);
          xmlTextCache.set(normalized, text);
          fileContentsCache.set(normalized, text);
          const name = parseXmlComponentName(text);
          if (name) componentNameToXml.set(name.toLowerCase(), normalized);
        } catch { /* skip */ }
      }
    }
  }

  // Scan project source (collect BRS + XML, read + parse in one pass)
  const sourceRoot = nodePath.join(projectRoot, sourceDir);
  const walkRoot = fsWrapper.existsSync(sourceRoot) ? sourceRoot : projectRoot;
  walkAndIndex(walkRoot, true);

  // Scan Kopytko packages (XML + BRS for extends chain resolution)
  // Also register all package directories to avoid existsSync in walk-up resolution
  const nmDir = nodePath.join(projectRoot, 'node_modules');
  try {
    for (const entry of fsWrapper.readdirTyped(nmDir)) {
      if (!entry.isDirectory) continue;
      if (entry.name.startsWith('@')) {
        try {
          for (const scoped of fsWrapper.readdirTyped(nodePath.join(nmDir, entry.name))) {
            if (!scoped.isDirectory) continue;
            const pkgDir = nodePath.join(nmDir, entry.name, scoped.name);
            allKnownPaths.push(pkgDir); // register package dir for walk-up resolution
            const moduleDir = readKopytkoModuleDir(pkgDir);
            if (moduleDir) walkAndIndex(nodePath.join(pkgDir, moduleDir), false);
          }
        } catch { /* skip */ }
      } else {
        const pkgDir = nodePath.join(nmDir, entry.name);
        allKnownPaths.push(pkgDir); // register package dir for walk-up resolution
        const moduleDir = readKopytkoModuleDir(pkgDir);
        if (moduleDir) walkAndIndex(nodePath.join(pkgDir, moduleDir), false);
      }
    }
  } catch { /* no node_modules */ }

  // Pre-seed the import resolver's existsSync cache with all discovered files
  importResolver.registerKnownPaths(allKnownPaths);

  // Build BRS→XML parent mapping
  for (const [xmlPath, xmlText] of xmlTextCache) {
    const scriptPaths = getScriptPathsFromXml(
      xmlPath, xmlText, workspaceFolders, sourceDir,
      (p) => importResolver.cachedExists(p),
    );
    for (const scriptPath of scriptPaths) {
      const normalizedScript = nodePath.normalize(scriptPath);
      const parents = brsToXmlParents.get(normalizedScript) ?? [];
      parents.push(xmlPath);
      brsToXmlParents.set(normalizedScript, parents);
    }
  }

  return buildKnownFunctions({
    importResolver, workspaceFolders, sourceDir, brsFiles,
    fileContentsCache, fileFunctions, fileImports,
    componentNameToXml, xmlTextCache, brsToXmlParents,
    linterConfig: config,
  });
}

// ── Shared logic for building per-file known functions ──

interface BuildParams {
  importResolver: ImportResolver;
  workspaceFolders: string[];
  sourceDir: string;
  brsFiles: string[];
  fileContentsCache: Map<string, string>;
  fileFunctions: Map<string, string[]>;
  fileImports: Map<string, KopytkoImport[]>;
  componentNameToXml: Map<string, string>;
  xmlTextCache: Map<string, string>;
  brsToXmlParents: Map<string, string[]>;
  linterConfig: LinterConfig;
}

function buildKnownFunctions(params: BuildParams): ProjectContextResult {
  const {
    importResolver, workspaceFolders, sourceDir, brsFiles,
    fileContentsCache, fileFunctions, fileImports,
    componentNameToXml, xmlTextCache, brsToXmlParents,
    linterConfig: config,
  } = params;

  const allFunctions = new Map<string, Set<string>>();
  // ancestor-only functions per file: functions that come exclusively from the extends chain
  // (not from the file's own definitions, imports, or XML siblings). Used by createFileContext
  // to populate ancestorFuncNames so the duplicate-function rule can exempt ancestor overrides.
  const ancestorFunctionsMap = new Map<string, Set<string>>();

  const readFileCached = (filePath: string): string | null => {
    const normalized = nodePath.normalize(filePath);
    const cached = fileContentsCache.get(normalized);
    if (cached !== undefined) return cached;
    try {
      const text = fsWrapper.readFileSync(filePath, 'utf-8');
      fileContentsCache.set(normalized, text);
      return text;
    } catch {
      return null;
    }
  };

  const getFunctions = (filePath: string): string[] => {
    const normalized = nodePath.normalize(filePath);
    const cached = fileFunctions.get(normalized);
    if (cached) return cached;
    const text = readFileCached(filePath);
    if (!text) return [];
    const fns = parseFunctionDefs(text, filePath).map(f => f.nameLower);
    fileFunctions.set(normalized, fns);
    return fns;
  };

  const getImports = (filePath: string): KopytkoImport[] => {
    const normalized = nodePath.normalize(filePath);
    const cached = fileImports.get(normalized);
    if (cached) return cached;
    const text = readFileCached(filePath);
    if (!text) return [];
    const imports = parseImports(text);
    fileImports.set(normalized, imports);
    return imports;
  };

  // Collect functions from an XML component's extends chain (map-based, no filesystem traversal)
  const extendsCache = new Map<string, string[]>();
  const collectFromExtendsChain = (componentNameLower: string): string[] => {
    const cached = extendsCache.get(componentNameLower);
    if (cached) return cached;

    const fns: string[] = [];
    const visitedComponents = new Set<string>();

    const walk = (nameLower: string): void => {
      if (visitedComponents.has(nameLower)) return;
      visitedComponents.add(nameLower);

      const xmlPath = componentNameToXml.get(nameLower);
      if (!xmlPath) return;

      const xmlText = xmlTextCache.get(xmlPath) ?? readFileCached(xmlPath);
      if (!xmlText) return;

      // Add functions from all BRS scripts listed in this XML
      const scriptPaths = getScriptPathsFromXml(
        xmlPath, xmlText, workspaceFolders, sourceDir,
        (p) => importResolver.cachedExists(p),
      );
      for (const scriptPath of scriptPaths) {
        for (const fn of getFunctions(scriptPath)) fns.push(fn);
        // Follow the script's @import chain
        const visited = new Set<string>();
        const followImports = (file: string): void => {
          for (const imp of getImports(file)) {
            const resolved = importResolver.resolveImportPath(imp, file);
            if (!resolved) continue;
            const norm = nodePath.normalize(resolved);
            if (visited.has(norm)) continue;
            visited.add(norm);
            for (const fn of getFunctions(resolved)) fns.push(fn);
            followImports(resolved);
          }
        };
        followImports(scriptPath);
      }

      // Walk up the extends chain
      const parentName = parseXmlExtends(xmlText);
      if (parentName) walk(parentName.toLowerCase());
    };

    walk(componentNameLower);
    extendsCache.set(componentNameLower, fns);
    return fns;
  };

  // ── Phase 4: Build per-file known function names ──
  for (const file of brsFiles) {
    const normalizedFile = nodePath.normalize(file);
    const known = new Set<string>();
    const ancestors = new Set<string>(); // extends-chain functions only (for ancestorFuncNames)
    for (const fn of (fileFunctions.get(normalizedFile) ?? [])) known.add(fn);

    // Add test framework globals for test and mock files
    if (isTestRelatedFile(file)) {
      for (const fn of TEST_FRAMEWORK_GLOBALS) known.add(fn);
    }

    const fileImps = fileImports.get(normalizedFile) ?? [];

    // For test files: auto-import mock config files (*.config.brs)
    // When @mock /path/to/Foo.brs is used, the build auto-imports _mocks/Foo.config.brs
    if (isTestFile(file)) {
      for (const imp of fileImps) {
        if (!imp.isMock) continue;
        const resolved = importResolver.resolveImportPath(imp, file);
        if (!resolved) continue;

        const dir = nodePath.dirname(resolved);
        const basename = nodePath.basename(resolved, '.brs');
        const configPath = nodePath.join(dir, '_mocks', `${basename}.config.brs`);
        const configFns = getFunctions(configPath);
        for (const fn of configFns) known.add(fn);

        // Also auto-import mock implementation files (_mocks/*.mock.brs)
        // The build replaces the original with the mock, which may define new functions
        const mockPath = nodePath.join(dir, '_mocks', `${basename}.mock.brs`);
        const mockFns = getFunctions(mockPath);
        for (const fn of mockFns) known.add(fn);
      }
    }

    // Add functions from generatedModules whose paths match this file's imports
    if (config.generatedModules.length > 0) {
      for (const imp of fileImps) {
        const mod = config.generatedModules.find((m) => matchesGlob(imp.importPath, m.path));
        if (mod) {
          for (const fn of mod.functions) known.add(fn.toLowerCase());
        }
      }
    }

    // Collect functions from @import chain (transitively)
    const visited = new Set<string>();
    const collectFromImports = (sourceFile: string, imps: KopytkoImport[]): void => {
      for (const imp of imps) {
        const resolved = importResolver.resolveImportPath(imp, sourceFile);
        if (!resolved) continue;
        const normalizedResolved = nodePath.normalize(resolved);
        if (visited.has(normalizedResolved)) continue;
        visited.add(normalizedResolved);

        for (const fn of getFunctions(resolved)) known.add(fn);
        collectFromImports(resolved, getImports(resolved));
      }
    };
    collectFromImports(file, getImports(file));

    // Add XML sibling functions — other BRS files in the same XML component
    const parentXmls = brsToXmlParents.get(normalizedFile) ?? [];
    for (const xmlPath of parentXmls) {
      const xmlText = readFileCached(xmlPath);
      if (!xmlText) continue;

      // Add all sibling BRS scripts from this XML
      const scriptPaths = getScriptPathsFromXml(
        xmlPath, xmlText, workspaceFolders, sourceDir,
        (p) => importResolver.cachedExists(p),
      );
      for (const scriptPath of scriptPaths) {
        const normalizedScript = nodePath.normalize(scriptPath);
        if (normalizedScript === normalizedFile) continue;
        if (!visited.has(normalizedScript)) {
          visited.add(normalizedScript);
          for (const fn of getFunctions(scriptPath)) known.add(fn);
          collectFromImports(scriptPath, getImports(scriptPath));
        }
      }

      // Walk the extends chain and add inherited functions
      const parentComponentName = parseXmlExtends(xmlText);
      if (parentComponentName) {
        for (const fn of collectFromExtendsChain(parentComponentName.toLowerCase())) {
          known.add(fn);
          ancestors.add(fn); // these are overrideable ancestor functions
        }
      }
    }

    // Add pattern sibling functions + their extends chains
    for (const siblingPath of findSiblingFiles(file, config.siblingPatterns)) {
      const normalizedSibling = nodePath.normalize(siblingPath);
      if (!visited.has(normalizedSibling)) {
        visited.add(normalizedSibling);
        for (const fn of getFunctions(siblingPath)) known.add(fn);
        collectFromImports(siblingPath, getImports(siblingPath));
      }
      // Pattern sibling's extends chain (e.g. view.brs may extend a component)
      const siblingXmls = brsToXmlParents.get(normalizedSibling) ?? [];
      for (const sxmlPath of siblingXmls) {
        const sxmlText = readFileCached(sxmlPath);
        if (!sxmlText) continue;
        const parentName = parseXmlExtends(sxmlText);
        if (parentName) {
          for (const fn of collectFromExtendsChain(parentName.toLowerCase())) {
            known.add(fn);
            ancestors.add(fn); // sibling's ancestor chain is also overrideable
          }
        }
      }
    }

    // For test files, add the tested file's FULL scope (same as extension's collectAllFunctions)
    if (isTestFile(file)) {
      for (const testedPath of resolveTestedFiles(file)) {
        const normalizedTested = nodePath.normalize(testedPath);
        if (!visited.has(normalizedTested)) {
          visited.add(normalizedTested);
          for (const fn of getFunctions(testedPath)) known.add(fn);
          collectFromImports(testedPath, getImports(testedPath));
        }

        // Tested file's XML siblings + extends chain
        const testedXmls = brsToXmlParents.get(normalizedTested) ?? [];
        for (const txmlPath of testedXmls) {
          const txmlText = readFileCached(txmlPath);
          if (!txmlText) continue;

          // Add all sibling scripts from the tested file's XML component
          const testedScripts = getScriptPathsFromXml(
            txmlPath, txmlText, workspaceFolders, sourceDir,
            (p) => importResolver.cachedExists(p),
          );
          for (const scriptPath of testedScripts) {
            const normalizedScript = nodePath.normalize(scriptPath);
            if (normalizedScript === normalizedTested) continue;
            if (!visited.has(normalizedScript)) {
              visited.add(normalizedScript);
              for (const fn of getFunctions(scriptPath)) known.add(fn);
              collectFromImports(scriptPath, getImports(scriptPath));
            }
          }

          // Extends chain
          const parentName = parseXmlExtends(txmlText);
          if (parentName) {
            for (const fn of collectFromExtendsChain(parentName.toLowerCase())) {
              known.add(fn);
              ancestors.add(fn);
            }
          }
        }

        // Tested file's pattern siblings + their extends
        for (const testedSibling of findSiblingFiles(testedPath, config.siblingPatterns)) {
          const normalizedTS = nodePath.normalize(testedSibling);
          if (!visited.has(normalizedTS)) {
            visited.add(normalizedTS);
            for (const fn of getFunctions(testedSibling)) known.add(fn);
            collectFromImports(testedSibling, getImports(testedSibling));
          }
        }
      }

      // Sibling test files (Foo.test.brs ↔ Foo_Bar.test.brs share scope)
      for (const siblingTest of findTestSiblings(file)) {
        const normalizedSibTest = nodePath.normalize(siblingTest);
        if (!visited.has(normalizedSibTest)) {
          visited.add(normalizedSibTest);
          for (const fn of getFunctions(siblingTest)) known.add(fn);
          collectFromImports(siblingTest, getImports(siblingTest));
        }
      }
    }

    allFunctions.set(normalizedFile, known);
    if (ancestors.size > 0) ancestorFunctionsMap.set(normalizedFile, ancestors);
  }

  // Collect functions from source/ directories (globally accessible by Roku convention).
  // Any .brs file whose path contains a segment named 'source' is compiled into the
  // app's global scope and callable from any component without an @import.
  const globalSourceFunctions = new Set<string>();
  for (const [filePath, fns] of fileFunctions) {
    if (filePath.replace(/\\/g, '/').includes('/source/')) {
      for (const fn of fns) globalSourceFunctions.add(fn);
    }
  }
  if (globalSourceFunctions.size > 0) {
    for (const known of allFunctions.values()) {
      for (const fn of globalSourceFunctions) known.add(fn);
    }
  }

  const context: LintContext = {
    get knownFuncNames() { return new Set<string>(); },

    parseImports(text: string): KopytkoImport[] {
      return parseImports(text);
    },

    resolveImportPath(importPath: string, documentPath: string, fromModule?: string): string | null {
      const imp: KopytkoImport = { raw: '', importPath, fromModule, line: 0 };
      return importResolver.resolveImportPath(imp, documentPath) ?? null;
    },

    importExists(importPath: string, documentPath: string, fromModule?: string): boolean {
      return this.resolveImportPath(importPath, documentPath, fromModule) !== null;
    },

    readFile(filePath: string): string | null {
      return readFileCached(filePath);
    },

    parseFunctionsFromFile(filePath: string): string[] {
      return getFunctions(filePath);
    },

    getSiblingFiles(filePath: string): string[] {
      return findSiblingFiles(filePath, config.siblingPatterns);
    },

    getTestSiblings(filePath: string): string[] {
      return findTestSiblings(filePath);
    },

    isTestFile(filePath: string): boolean {
      return isTestFile(filePath);
    },

    generatedPaths: config.generatedPaths,
    generatedModules: config.generatedModules,
    siblingPatterns: config.siblingPatterns,
  };

  return {
    context: Object.assign(context, {
      _allFunctions: allFunctions,
      _ownFunctions: fileFunctions,
      _ancestorFunctions: ancestorFunctionsMap,
    }) as LintContext,
    brsFiles,
    fileContentsCache,
  };
}

/** Read `kopytkoModuleDir` from a package's package.json. Returns null if not a Kopytko package. */
function readKopytkoModuleDir(pkgDir: string): string | null {
  try {
    const content = fsWrapper.readFileSync(nodePath.join(pkgDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content) as { kopytkoModuleDir?: string };
    return pkg.kopytkoModuleDir ?? null;
  } catch {
    return null;
  }
}
