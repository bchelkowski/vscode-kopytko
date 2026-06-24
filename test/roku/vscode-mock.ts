/**
 * Minimal vscode mock for testing client-side modules outside the VS Code
 * Extension Host. Registers itself into the Node module cache so that
 * `require('vscode')` / `import * as vscode from 'vscode'` resolves
 * to this stub.
 */

import { EventEmitter } from 'events';
import Module from 'module';

const vscodeStub = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  EventEmitter: class VscodeEventEmitter<T> {
    private emitter = new EventEmitter();
    event = (listener: (e: any) => void) => {
      this.emitter.on('fire', listener);
      return { dispose: () => this.emitter.off('fire', listener) };
    };
    fire(data: any) {
      this.emitter.emit('fire', data);
    }
    dispose() {
      this.emitter.removeAllListeners();
    }
  },
  workspace: {
    getConfiguration: (_section?: string) => ({
      get: <T>(_key: string, defaultValue: T): T => defaultValue,
    }),
  },
  window: {
    state: { focused: true },
    onDidChangeWindowState: () => ({ dispose: () => {} }),
    showWarningMessage: (..._args: unknown[]) => Promise.resolve(undefined),
    showInformationMessage: (..._args: unknown[]) => Promise.resolve(undefined),
  },
  TreeItemCheckboxState: { Checked: 1, Unchecked: 0 },
  Disposable: class {
    dispose() {}
  },
  TreeItem: class TreeItem {
    label: string | undefined;
    collapsibleState: number | undefined;
    description?: string;
    tooltip?: any;
    iconPath?: any;
    contextValue?: string;
    command?: any;
    constructor(label: string | { label: string }, collapsibleState?: number) {
      this.label = typeof label === 'string' ? label : label.label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class ThemeIcon {
    id: string;
    constructor(id: string) { this.id = id; }
  },
  MarkdownString: class MarkdownString {
    value: string;
    constructor(value?: string) { this.value = value ?? ''; }
  },
};

// Inject into Node's require cache so `require('vscode')` resolves
const fakeModule = new Module('vscode');
fakeModule.exports = vscodeStub;
(fakeModule as any).loaded = true;
require.cache['vscode'] = fakeModule;

// Also handle ESM-style resolution by patching _resolveFilename
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') return 'vscode';
  return originalResolve.call(this, request, ...args);
};
