import * as nodePath from 'path';
import fsWrapper from '../utils/fsWrapper';
import { KopytkoImportResolver } from '../kopytko/importResolver';
import {
  parseXmlExtends,
  parseXmlInterface,
  getScriptPathsFromXml,
  findComponentXml,
} from './xmlScriptParser';
import {
  findSgNode,
  getAllSgNodeFields,
  getAllSgNodeMethods,
  SgNodeField,
  SgNodeMethod,
} from './sgNodes';
import { buildSearchRoots } from '../utils/workspaceUtils';

export interface MtopField {
  name: string;
  type: string;
  description: string;
  readonly?: boolean;
}

export interface MtopMethod {
  name: string;
  signature: string;
  returnType: string;
  description: string;
  interface?: string;
}

interface MtopItems {
  fields: MtopField[];
  methods: MtopMethod[];
}

function collectFromXmlChain(
  xmlPath: string,
  importResolver: KopytkoImportResolver,
  fields: MtopField[],
  methods: MtopMethod[],
  visitedXmls: Set<string>,
): void {
  if (visitedXmls.has(xmlPath)) return;
  visitedXmls.add(xmlPath);

  let xmlText: string;
  try {
    xmlText = fsWrapper.readFileSync(xmlPath, 'utf-8');
  } catch {
    return;
  }

  const iface = parseXmlInterface(xmlText);
  for (const f of iface.fields) {
    fields.push({ name: f.name, type: f.type, description: 'Declared in component XML interface.' });
  }
  for (const fn of iface.functions) {
    fields.push({ name: fn.name, type: 'function', description: 'Interface function declared in component XML.' });
  }

  const parentName = parseXmlExtends(xmlText);
  if (!parentName) return;

  if (findSgNode(parentName)) {
    for (const f of getAllSgNodeFields(parentName)) {
      fields.push(sgFieldToMtop(f));
    }
    for (const m of getAllSgNodeMethods(parentName)) {
      methods.push(sgMethodToMtop(m));
    }
    return;
  }

  const searchRoots = buildSearchRoots(importResolver, xmlPath);
  const parentXml = findComponentXml(parentName, searchRoots);
  if (!parentXml) return;

  collectFromXmlChain(parentXml, importResolver, fields, methods, visitedXmls);
}

function sgFieldToMtop(f: SgNodeField): MtopField {
  return { name: f.name, type: f.type, description: f.description, readonly: f.readonly };
}

function sgMethodToMtop(m: SgNodeMethod): MtopMethod {
  return { name: m.name, signature: m.signature, returnType: m.returnType, description: m.description, interface: m.interface };
}

/**
 * Collects all fields and methods accessible via `m.top.` for a BrightScript
 * file that belongs to a SceneGraph component.
 *
 * Walks:
 *  1. The component's own XML `<interface>` fields and `<function>` declarations
 *  2. User-defined parent components (via `extends`) recursively
 *  3. Roku native SG node fields/methods when the chain reaches a catalog entry
 */
export function collectMtopItems(
  brsPath: string,
  importResolver: KopytkoImportResolver,
): MtopItems {
  const fields: MtopField[] = [];
  const methods: MtopMethod[] = [];
  const visitedXmls = new Set<string>();
  const workspaceFolders = importResolver.getWorkspaceFolders();
  const sourceDir = importResolver.getSourceDir();

  const brsDir = nodePath.dirname(brsPath);
  const brsBasename = nodePath.basename(brsPath);
  let xmlCandidates: string[] = [];
  try {
    xmlCandidates = fsWrapper.readdirSync(brsDir)
      .filter((f) => f.endsWith('.xml'))
      .map((f) => nodePath.join(brsDir, f));
  } catch { /* ignore */ }

  for (const xmlPath of xmlCandidates) {
    let xmlText: string;
    try {
      xmlText = fsWrapper.readFileSync(xmlPath, 'utf-8');
    } catch {
      continue;
    }
    if (!xmlText.includes(brsBasename)) continue;
    const listed = getScriptPathsFromXml(xmlPath, workspaceFolders, sourceDir);
    if (!listed.includes(brsPath)) continue;

    collectFromXmlChain(xmlPath, importResolver, fields, methods, visitedXmls);
  }

  return { fields, methods };
}
