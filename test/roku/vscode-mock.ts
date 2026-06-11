/**
 * Minimal vscode mock for testing client-side modules outside the VS Code
 * Extension Host. Registers itself into the Node module cache so that
 * `require('vscode')` / `import * as vscode from 'vscode'` resolves
 * to this stub.
 */

import { EventEmitter } from 'events';
import Module from 'module';

const vscodeStub = {
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
  window: {
    state: { focused: true },
    onDidChangeWindowState: () => ({ dispose: () => {} }),
  },
  Disposable: class {
    dispose() {}
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
