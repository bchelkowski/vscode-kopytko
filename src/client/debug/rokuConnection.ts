import * as net from 'net';
import { EventEmitter } from 'events';

export const ROKU_DEBUG_PORT = 8085;

export interface DebugStop {
  file: string;
  line: number;
  kind: 'breakpoint' | 'error' | 'runtime';
  message?: string;
}

export interface DebugFrame {
  index: number;
  functionName: string;
  file: string;
  line: number;
}

export interface DebugVariable {
  name: string;
  type: string;
  value: string;
}

export interface DebugVariables {
  locals: DebugVariable[];
  globals: DebugVariable[];
}

/**
 * Manages the telnet-style TCP connection to the Roku BrightScript debugger
 * on port 8085. Emits:
 *   'stopped'     — DebugStop  — program paused at a breakpoint or error
 *   'output'      — string     — any console output from the running program
 *   'compileError'— string     — compilation failure message
 *   'terminated'  — (no args) — program finished or connection closed
 *   'error'       — Error      — socket error
 */
export class RokuConnection extends EventEmitter {
  private _socket: net.Socket | null = null;
  private _buffer = '';
  private _pendingCommand: ((output: string) => void) | null = null;

  connect(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      this._socket = socket;

      socket.setTimeout(12000);
      socket.on('timeout', () => socket.setTimeout(0)); // one-time connect timeout

      socket.on('data', (chunk) => this._onData(chunk.toString()));
      socket.on('error', (err) => { this.emit('error', err); reject(err); });
      socket.on('close', () => this.emit('terminated'));

      socket.connect(ROKU_DEBUG_PORT, host, () => {
        // Wait for the initial banner + first prompt
        this._waitForPrompt(10000)
          .then(() => resolve())
          .catch((err) => { socket.destroy(); reject(err); });
      });
    });
  }

  private _onData(text: string): void {
    this._buffer += text;

    // Compilation errors arrive before the program even starts
    const compileMatch =
      /-------->?\s+(?:Compile error|compile error|error)[^:\n]*:?\s*([^\n]+)/i.exec(this._buffer);
    if (compileMatch) {
      this.emit('compileError', compileMatch[1].trim());
    }

    // Program output lines (not debugger prompt lines)
    const outputLines = text.split(/\r?\n/).filter(
      (l) => l && !l.startsWith('BrightScript Debugger') && !l.startsWith('#')
    );
    for (const line of outputLines) {
      this.emit('output', line);
    }

    // App terminated
    if (/=== Application (?:Exited|Closed)|Execution exits/i.test(this._buffer)) {
      this.emit('terminated');
      return;
    }

    if (this._buffer.includes('BrightScript Debugger> ')) {
      const accumulated = this._buffer;
      this._buffer = '';

      if (this._pendingCommand) {
        const cb = this._pendingCommand;
        this._pendingCommand = null;
        cb(accumulated);
      } else {
        // Spontaneous pause — parse the stop location
        this._parseSpontaneousStop(accumulated);
      }
    }
  }

  private _parseSpontaneousStop(output: string): void {
    // STOP (at line 42 in /pkg:/components/MainScene.brs)
    const stopMatch = /STOP\s*\(at line (\d+) in ([^)]+)\)/i.exec(output);
    if (stopMatch) {
      this.emit('stopped', {
        file: stopMatch[2].trim(),
        line: parseInt(stopMatch[1], 10),
        kind: 'breakpoint',
      } satisfies DebugStop);
      return;
    }

    // Runtime error — in /pkg:/file.brs(42): message
    const errMatch = /in ([^(]+\.brs)\s*\((\d+)\)[^:]*:?\s*([^\n]+)?/i.exec(output);
    if (errMatch) {
      this.emit('stopped', {
        file: errMatch[1].trim(),
        line: parseInt(errMatch[2], 10),
        kind: 'error',
        message: errMatch[3]?.trim(),
      } satisfies DebugStop);
      return;
    }

    // Generic pause
    this.emit('stopped', { file: '', line: 0, kind: 'runtime' } satisfies DebugStop);
  }

  private _waitForPrompt(timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('BrightScript debugger did not respond in time')),
        timeoutMs
      );
      this._pendingCommand = (data) => { clearTimeout(timer); resolve(data); };
    });
  }

  /** Send a command and wait for the debugger prompt response. */
  async sendCommand(cmd: string): Promise<string> {
    if (!this._socket) throw new Error('Debugger not connected');
    this._socket.write(`${cmd}\r\n`);
    return this._waitForPrompt();
  }

  async getStackFrames(): Promise<DebugFrame[]> {
    const output = await this.sendCommand('bt');
    const frames: DebugFrame[] = [];
    // #0  Function init() As Void\n   file/line: /pkg:/components/Scene.brs(42)
    const frameRe = /#(\d+)\s+(.+?)\n\s+file\/line:\s+([^\n(]+)\((\d+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = frameRe.exec(output)) !== null) {
      frames.push({
        index: parseInt(m[1], 10),
        functionName: m[2].trim(),
        file: m[3].trim(),
        line: parseInt(m[4], 10),
      });
    }
    return frames;
  }

  async getVariables(): Promise<DebugVariables> {
    const output = await this.sendCommand('vars');
    const locals: DebugVariable[] = [];
    const globals: DebugVariable[] = [];
    let section: 'locals' | 'globals' | null = null;

    for (const raw of output.split('\n')) {
      const line = raw.trim();
      if (/^Local Variables:/i.test(line)) { section = 'locals'; continue; }
      if (/^Global Variables:/i.test(line)) { section = 'globals'; continue; }
      if (!section) continue;

      // var =<Type> value
      const m = /^(\w+)\s*[=:]\s*<([^>]+)>\s*(.*)$/.exec(line);
      if (!m) continue;
      const v: DebugVariable = { name: m[1], type: m[2], value: m[3].trim() || `<${m[2]}>` };
      if (section === 'locals') locals.push(v); else globals.push(v);
    }

    return { locals, globals };
  }

  /** Continue program execution (does not wait for the next stop). */
  continue(): void {
    this._socket?.write('cont\r\n');
    this._buffer = '';
  }

  async stepOver(): Promise<void> {
    if (!this._socket) return;
    this._socket.write('over\r\n');
    await this._waitForPrompt();
  }

  async stepIn(): Promise<void> {
    if (!this._socket) return;
    this._socket.write('step\r\n');
    await this._waitForPrompt();
  }

  async stepOut(): Promise<void> {
    if (!this._socket) return;
    this._socket.write('out\r\n');
    await this._waitForPrompt();
  }

  close(): void {
    this._socket?.destroy();
    this._socket = null;
  }
}
