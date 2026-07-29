import type { LintDiagnostic, LintSeverity } from '../types';

export const DUPLICATE_COMPONENT_RULE = 'component/duplicate-name';

/** A `<component name="…">` declaration and where it is written. */
export interface ComponentDeclaration {
  name: string;
  /** Absolute path of the declaring XML file. */
  filePath: string;
  /** Zero-based position of the `name` attribute *value*. */
  line: number;
  column: number;
}

/** One component name declared by two or more files. */
export interface DuplicateComponentGroup {
  name: string;
  /** Two or more declarations, ordered by file path. */
  declarations: ComponentDeclaration[];
}

export interface DuplicateComponentOptions {
  severity?: LintSeverity;
  /**
   * Files to ignore completely — they are dropped *before* the duplicate count,
   * so a name whose only surviving declaration is the excluded one is not
   * reported at all. Use for build-output copies of the source tree.
   */
  isExcluded?: (filePath: string) => boolean;
  /**
   * Files a diagnostic may be attached to. Excluded files still *count* toward
   * the collision — a project component clashing with one from an installed
   * package is a real conflict — but a warning inside `node_modules` is noise
   * the user cannot act on, so by default only non-package files are reported.
   */
  isReportable?: (filePath: string) => boolean;
  /** Renders the other declarations' paths in the message. Defaults to identity. */
  displayPath?: (filePath: string) => string;
}

const NODE_MODULES_RE = /(^|[\\/])node_modules[\\/]/;

/** True for files outside any installed package — the default `isReportable`. */
export function isProjectFile(filePath: string): boolean {
  return !NODE_MODULES_RE.test(filePath);
}

/**
 * Groups declarations that share a name (case-insensitively).
 *
 * SceneGraph component names are global to the channel: `CreateObject(
 * "roSGNode", "X")` and `<X />` resolve by name alone, with no notion of a
 * declaring file, so a second declaration silently overrides the first
 * depending on load order.
 *
 * Groups are ordered by name and declarations within a group by file path, so
 * the output is stable across runs and platforms.
 */
export function findDuplicateComponents(
  declarations: ComponentDeclaration[],
  isExcluded?: (filePath: string) => boolean,
): DuplicateComponentGroup[] {
  const byName = new Map<string, ComponentDeclaration[]>();

  for (const declaration of declarations) {
    if (isExcluded?.(declaration.filePath)) continue;
    const key = declaration.name.toLowerCase();
    const group = byName.get(key);
    if (group) {
      group.push(declaration);
    } else {
      byName.set(key, [declaration]);
    }
  }

  const duplicates: DuplicateComponentGroup[] = [];
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.filePath.localeCompare(b.filePath));
    duplicates.push({ name: sorted[0].name, declarations: sorted });
  }
  return duplicates.sort((a, b) => a.name.localeCompare(b.name));
}

/** The message shown on one declaration, naming the others. */
export function duplicateComponentMessage(
  declaration: ComponentDeclaration,
  others: ComponentDeclaration[],
  displayPath: (filePath: string) => string = (p) => p,
): string {
  const elsewhere = others.map((o) => displayPath(o.filePath)).join(', ');
  return (
    `Duplicate component name "${declaration.name}" — also declared in ${elsewhere}. `
    + 'SceneGraph component names are global to the channel, so whichever declaration loads '
    + `last wins and CreateObject("roSGNode", "${declaration.name}") is ambiguous. Rename one of them.`
  );
}

/**
 * The whole check: group, then emit one diagnostic per reportable declaration.
 *
 * Pure — takes declarations, touches no filesystem — so the CLI project pass and
 * the editor's incremental component index can share it.
 */
export function duplicateComponentDiagnostics(
  declarations: ComponentDeclaration[],
  options: DuplicateComponentOptions = {},
): LintDiagnostic[] {
  const {
    severity = 'warning',
    isExcluded,
    isReportable = isProjectFile,
    displayPath,
  } = options;

  const diagnostics: LintDiagnostic[] = [];
  for (const group of findDuplicateComponents(declarations, isExcluded)) {
    for (const declaration of group.declarations) {
      if (!isReportable(declaration.filePath)) continue;
      const others = group.declarations.filter((d) => d !== declaration);
      diagnostics.push({
        code: DUPLICATE_COMPONENT_RULE,
        message: duplicateComponentMessage(declaration, others, displayPath),
        severity,
        line: declaration.line,
        column: declaration.column,
        endLine: declaration.line,
        endColumn: declaration.column + declaration.name.length,
        filePath: declaration.filePath,
      });
    }
  }
  return diagnostics;
}
