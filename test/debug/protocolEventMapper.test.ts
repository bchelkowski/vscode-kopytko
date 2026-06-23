import { expect } from 'chai';
import { BinaryWriter } from '../../src/client/debug/protocol/binaryIO';
import { StopReason, UpdateType } from '../../src/client/debug/protocol/constants';
import { ProtocolEventMapper } from '../../src/client/debug/protocolEventMapper';

function stoppedPayload(threadIndex: number, reason: StopReason, detail = ''): Buffer {
  const writer = new BinaryWriter();
  writer.writeInt32(threadIndex);
  writer.writeUint8(reason);
  if (detail) writer.writeStringNT(detail);
  return writer.toBuffer();
}

function breakpointVerifiedPayload(...ids: number[]): Buffer {
  const writer = new BinaryWriter();
  writer.writeUint32(0);
  writer.writeUint32(ids.length);
  for (const id of ids) writer.writeUint32(id);
  return writer.toBuffer();
}

function compileErrorPayload(message: string, filePath: string, lineNumber: number): Buffer {
  const writer = new BinaryWriter();
  writer.writeUint32(0);
  writer.writeStringNT(message);
  writer.writeStringNT(filePath);
  writer.writeUint32(lineNumber);
  writer.writeStringNT('');
  return writer.toBuffer();
}

describe('ProtocolEventMapper', () => {
  const mapper = new ProtocolEventMapper();

  it('maps stopped updates to DAP stopped events and runtime output', () => {
    const result = mapper.mapUpdate(
      UpdateType.AllThreadsStopped,
      stoppedPayload(2, StopReason.RuntimeError, 'boom'),
      { suppressInitialStop: false, sourceRoot: '/workspace/app' },
    );

    expect(result.stopped).to.equal(true);
    expect(result.primaryThreadIndex).to.equal(2);
    expect(result.resetVariables).to.equal(true);
    expect(result.outputs).to.deep.equal([{ category: 'stderr', output: 'Runtime error — boom\n' }]);
    expect(result.events).to.deep.equal([{
      event: 'stopped',
      body: { reason: 'exception', threadId: 3, description: 'boom', allThreadsStopped: true },
    }]);
  });

  it('suppresses the initial stop without emitting DAP events', () => {
    const result = mapper.mapUpdate(
      UpdateType.AllThreadsStopped,
      stoppedPayload(0, StopReason.Break),
      { suppressInitialStop: true, sourceRoot: '/workspace/app' },
    );

    expect(result).to.deep.equal({ events: [], outputs: [], stopped: true, primaryThreadIndex: 0 });
  });

  it('maps normal app exit to output and terminated', () => {
    const result = mapper.mapUpdate(
      UpdateType.AllThreadsStopped,
      stoppedPayload(0, StopReason.NormalExit),
      { suppressInitialStop: false, sourceRoot: '/workspace/app' },
    );

    expect(result.outputs).to.deep.equal([{ category: 'console', output: 'App exited normally.\n' }]);
    expect(result.events).to.deep.equal([{ event: 'terminated', body: {} }]);
  });

  it('maps thread attached updates to stopped events', () => {
    const result = mapper.mapUpdate(
      UpdateType.ThreadAttached,
      stoppedPayload(1, StopReason.StopStatement, 'stop'),
      { suppressInitialStop: false, sourceRoot: '/workspace/app' },
    );

    expect(result.stopped).to.equal(true);
    expect(result.resetVariables).to.equal(true);
    expect(result.events).to.deep.equal([{
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 2, description: 'stop', allThreadsStopped: true },
    }]);
  });

  it('maps breakpoint verification updates to DAP breakpoint events', () => {
    const result = mapper.mapUpdate(
      UpdateType.BreakpointVerified,
      breakpointVerifiedPayload(7, 9),
      { suppressInitialStop: false, sourceRoot: '/workspace/app' },
    );

    expect(result.events).to.deep.equal([
      { event: 'breakpoint', body: { reason: 'changed', breakpoint: { id: 7, verified: true } } },
      { event: 'breakpoint', body: { reason: 'changed', breakpoint: { id: 9, verified: true } } },
    ]);
  });

  it('maps compile errors to output and diagnostic data', () => {
    const result = mapper.mapUpdate(
      UpdateType.CompileError,
      compileErrorPayload('syntax error', 'pkg:/components/Main.brs', 12),
      { suppressInitialStop: false, sourceRoot: '/workspace/app' },
    );

    expect(result.outputs).to.deep.equal([{
      category: 'stderr',
      output: 'Compile error: syntax error (pkg:/components/Main.brs:12)\n',
    }]);
    expect(result.compileDiagnostic).to.deep.equal({
      localPath: '/workspace/app/components/Main.brs',
      message: 'syntax error',
      lineNumber: 12,
    });
  });
});
