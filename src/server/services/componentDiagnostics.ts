import * as path from 'path';
import { Connection } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import {
  type LintSeverity,
  type ComponentDeclaration,
  duplicateComponentDiagnostics,
} from 'kopytko-linter';
import { toLspDiagnostic } from '../providers/shared/lintDiagnostic';
import { WorkspaceComponentIndex } from '../utils/workspaceComponentIndex';

export { DUPLICATE_COMPONENT_RULE } from 'kopytko-linter';

export interface ComponentDiagnosticsDeps {
  index: WorkspaceComponentIndex;
  /** Paths the user has excluded from linting (`kopytko.lint.readOnlyPaths`). */
  isExcluded: (filePath: string) => boolean;
  workspaceFolders: () => string[];
  /** Configured severity for the rule, or `'off'` to disable it. */
  severity?: () => LintSeverity | 'off';
}

/**
 * Publishes the linter's `component/duplicate-name` check against the editor's
 * live component index.
 *
 * The CLI runs the same check over a whole project in one pass
 * (`lintProject`); this runs it incrementally, off `WorkspaceComponentIndex`,
 * so a duplicate appears as soon as the offending file is saved rather than on
 * the next CI run. The grouping, message, and severity all come from the shared
 * core — this class only adapts declarations in and LSP diagnostics out.
 *
 * The diagnostics are published against the XML files themselves. XML is not a
 * synced document (see `registerXmlTypeHierarchy` in `server.ts`), but
 * `sendDiagnostics` does not require one — entries appear in the Problems panel
 * and become squiggles as soon as the file is opened.
 */
export class ComponentDiagnosticsService {
  /** URIs currently carrying diagnostics, so stale ones can be cleared. */
  private _publishedUris = new Set<string>();

  constructor(
    private readonly connection: Connection,
    private readonly deps: ComponentDiagnosticsDeps,
  ) {}

  /** Recomputes and republishes. Safe to call on every index change. */
  refresh(): void {
    const severity = this.deps.severity?.() ?? 'warning';
    const diagnostics = severity === 'off' ? [] : duplicateComponentDiagnostics(
      this._declarations(),
      {
        severity,
        isExcluded: this.deps.isExcluded,
        displayPath: (filePath) => this._displayPath(filePath),
      },
    );

    const byUri = new Map<string, ReturnType<typeof toLspDiagnostic>[]>();
    for (const diagnostic of diagnostics) {
      const uri = URI.file(diagnostic.filePath).toString();
      const list = byUri.get(uri);
      if (list) {
        list.push(toLspDiagnostic(diagnostic));
      } else {
        byUri.set(uri, [toLspDiagnostic(diagnostic)]);
      }
    }

    for (const [uri, list] of byUri) {
      this.connection.sendDiagnostics({ uri, diagnostics: list });
    }
    for (const uri of this._publishedUris) {
      if (!byUri.has(uri)) this.connection.sendDiagnostics({ uri, diagnostics: [] });
    }
    this._publishedUris = new Set(byUri.keys());
  }

  /** Clears every published diagnostic. */
  clear(): void {
    for (const uri of this._publishedUris) {
      this.connection.sendDiagnostics({ uri, diagnostics: [] });
    }
    this._publishedUris.clear();
  }

  /** The index's entries in the shape the shared check expects. */
  private _declarations(): ComponentDeclaration[] {
    return this.deps.index.getAll().map((entry) => ({
      name: entry.name,
      filePath: entry.filePath,
      line: entry.nameLine,
      column: entry.nameColumn,
    }));
  }

  /** Workspace-relative where possible — absolute paths make the message unreadable. */
  private _displayPath(filePath: string): string {
    for (const folder of this.deps.workspaceFolders()) {
      const relative = path.relative(folder, filePath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return relative.split(path.sep).join('/');
      }
    }
    return filePath;
  }
}
