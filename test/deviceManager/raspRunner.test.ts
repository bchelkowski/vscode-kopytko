import { expect } from 'chai';
import * as sinon from 'sinon';
import type { EcpClient } from 'kopytko-roku-device';
import { RaspRunner, RaspStepError, countSteps, labelOf } from '../../src/client/deviceManager/rasp/raspRunner';
import type { RaspScript, RaspStep, RaspStepEvent } from '../../src/client/deviceManager/rasp/raspTypes';

const TARGET = { ip: '10.0.0.2', port: 8060 };

function makeScript(steps: RaspStep[], defaultKeypressWaitSec = 0): RaspScript {
  return { raspVersion: 1, defaultKeypressWaitSec, channels: {}, steps };
}

interface EcpStub {
  keypress: sinon.SinonStub;
  sendText: sinon.SinonStub;
  launchApp: sinon.SinonStub;
  queryActiveApp: sinon.SinonStub;
  queryMediaPlayer: sinon.SinonStub;
}

function makeEcp(): EcpStub {
  return {
    keypress: sinon.stub().resolves(),
    sendText: sinon.stub().resolves(),
    launchApp: sinon.stub().resolves(),
    queryActiveApp: sinon.stub().resolves({ id: 'dev', name: 'Dev App' }),
    queryMediaPlayer: sinon.stub().resolves({ state: 'play', error: false }),
  };
}

function run(ecp: EcpStub, script: RaspScript, onStep?: (e: RaspStepEvent) => void, signal?: AbortSignal): Promise<void> {
  const runner = new RaspRunner(ecp as unknown as EcpClient);
  return runner.run(script, TARGET, {
    signal: signal ?? new AbortController().signal,
    onStep,
    pollIntervalMs: 10,
    waitTimeoutSec: 1,
  });
}

describe('RaspRunner', () => {
  afterEach(() => sinon.restore());

  it('executes press/text steps in order against the target device', async () => {
    const ecp = makeEcp();
    const events: RaspStepEvent[] = [];

    await run(ecp, makeScript([
      { kind: 'press', key: 'Home' },
      { kind: 'text', text: 'abc' },
      { kind: 'press', key: 'Select' },
    ]), (e) => events.push(e));

    expect(ecp.keypress.firstCall.args).to.deep.equal(['10.0.0.2', 'Home', 8060]);
    expect(ecp.sendText.firstCall.args).to.deep.equal(['10.0.0.2', 'abc', 8060]);
    expect(ecp.keypress.secondCall.args).to.deep.equal(['10.0.0.2', 'Select', 8060]);
    sinon.assert.callOrder(ecp.keypress, ecp.sendText, ecp.keypress);

    // running+ok per step, total flattened count on every event
    expect(events.map((e) => `${e.index}:${e.status}`)).to.deep.equal([
      '0:running', '0:ok', '1:running', '1:ok', '2:running', '2:ok',
    ]);
    expect(events.every((e) => e.total === 3)).to.equal(true);
  });

  it('waits default_keypress_wait after each press', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();

    const done = run(ecp, makeScript([
      { kind: 'press', key: 'Up' },
      { kind: 'press', key: 'Down' },
    ], 2));

    await clock.tickAsync(0);
    expect(ecp.keypress.callCount).to.equal(1);
    await clock.tickAsync(1999);
    expect(ecp.keypress.callCount).to.equal(1);
    await clock.tickAsync(1);
    await clock.tickAsync(0);
    expect(ecp.keypress.callCount).to.equal(2);
    await clock.tickAsync(2000);
    await done;
  });

  it('expands loops, reporting per-iteration paths and a flattened total', async () => {
    const ecp = makeEcp();
    const events: RaspStepEvent[] = [];

    await run(ecp, makeScript([
      { kind: 'loop', iterations: 2, steps: [{ kind: 'press', key: 'Down' }, { kind: 'press', key: 'Right' }] },
    ]), (e) => events.push(e));

    expect(ecp.keypress.callCount).to.equal(4);
    const running = events.filter((e) => e.status === 'running');
    expect(running.map((e) => e.path)).to.deep.equal([
      'steps[0].loop[0][0]', 'steps[0].loop[0][1]',
      'steps[0].loop[1][0]', 'steps[0].loop[1][1]',
    ]);
    expect(running.every((e) => e.total === 4)).to.equal(true);
  });

  it('pause waits the given seconds', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();
    let finished = false;

    const done = run(ecp, makeScript([{ kind: 'pause', seconds: 5 }])).then(() => { finished = true; });

    await clock.tickAsync(4999);
    expect(finished).to.equal(false);
    await clock.tickAsync(1);
    await done;
    expect(finished).to.equal(true);
  });

  it('launch sends deep-link params and polls until the channel is foreground', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();
    ecp.queryActiveApp.onFirstCall().resolves({ id: '562859', name: 'Home' });
    ecp.queryActiveApp.onSecondCall().resolves({ id: 'dev', name: 'Dev App' });

    const done = run(ecp, makeScript([
      { kind: 'launch', channelId: 'dev', channelName: 'Dev', contentId: 'c1', mediaType: 'movie', timeoutSec: 5 },
    ]));

    await clock.tickAsync(50);
    await done;

    expect(ecp.launchApp.firstCall.args).to.deep.equal(
      ['10.0.0.2', 'dev', { contentId: 'c1', mediaType: 'movie' }, 8060],
    );
    expect(ecp.queryActiveApp.callCount).to.equal(2);
  });

  it('launch fails when the channel never becomes foreground within the timeout', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();
    ecp.queryActiveApp.resolves({ id: '12', name: 'Netflix' });

    const done = run(ecp, makeScript([
      { kind: 'launch', channelId: 'dev', timeoutSec: 1 },
    ]));
    const outcome = done.then(() => 'resolved', (err: Error) => err);

    await clock.tickAsync(1100);
    const err = await outcome;
    expect(err).to.be.instanceOf(RaspStepError);
    expect((err as RaspStepError).message).to.include('did not become active');
  });

  it('wait_for_player_state polls until the state matches', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();
    ecp.queryMediaPlayer.onCall(0).resolves({ state: 'buffer', error: false });
    ecp.queryMediaPlayer.onCall(1).resolves({ state: 'buffer', error: false });
    ecp.queryMediaPlayer.onCall(2).resolves({ state: 'play', error: false });

    const done = run(ecp, makeScript([{ kind: 'wait_for_player_state', state: 'play' }]));
    await clock.tickAsync(100);
    await done;

    expect(ecp.queryMediaPlayer.callCount).to.equal(3);
  });

  it('wait_for_player_state "stop" also matches none/close', async () => {
    const ecp = makeEcp();
    ecp.queryMediaPlayer.resolves({ state: 'none', error: false });

    await run(ecp, makeScript([{ kind: 'wait_for_player_state', state: 'stop' }]));
    expect(ecp.queryMediaPlayer.callCount).to.equal(1);
  });

  it('wait_for_player_state fails after the timeout with the last seen state', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();
    ecp.queryMediaPlayer.resolves({ state: 'pause', error: false });
    const events: RaspStepEvent[] = [];

    const done = run(ecp, makeScript([{ kind: 'wait_for_player_state', state: 'play' }]), (e) => events.push(e));
    const outcome = done.then(() => 'resolved', (err: Error) => err);

    await clock.tickAsync(1100);
    const err = await outcome;
    expect(err).to.be.instanceOf(RaspStepError);
    expect((err as Error).message).to.include('pause');
    expect(events.at(-1)?.status).to.equal('failed');
  });

  it('validate_streaming passes when the reported format matches case-insensitively', async () => {
    const ecp = makeEcp();
    ecp.queryMediaPlayer.resolves({
      state: 'play', error: false,
      format: { audio: 'AAC', video: 'hevc', drm: 'Widevine' },
    });

    await run(ecp, makeScript([
      { kind: 'validate_streaming', audioCodec: 'aac', videoCodec: 'hevc', drm: 'widevine' },
    ]));
  });

  it('validate_streaming fails listing every mismatched field', async () => {
    const ecp = makeEcp();
    ecp.queryMediaPlayer.resolves({
      state: 'play', error: false,
      format: { audio: 'aac', video: 'mpeg4_2', drm: 'none' },
    });

    const outcome = run(ecp, makeScript([
      { kind: 'validate_streaming', audioCodec: 'ac3', drm: 'widevine' },
    ])).then(() => 'resolved', (err: Error) => err);

    const err = await outcome;
    expect(err).to.be.instanceOf(RaspStepError);
    expect((err as Error).message).to.include('audio_codec');
    expect((err as Error).message).to.include('drm');
    expect((err as Error).message).to.not.include('video_codec');
  });

  it('validate_streaming fails when nothing is playing', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();
    ecp.queryMediaPlayer.resolves({ state: 'none', error: false });

    const outcome = run(ecp, makeScript([{ kind: 'validate_streaming', drm: 'widevine' }]))
      .then(() => 'resolved', (err: Error) => err);

    await clock.tickAsync(1100);
    const err = await outcome;
    expect((err as Error).message).to.include('not playing');
  });

  it('a failed step stops the run — later steps never execute', async () => {
    const ecp = makeEcp();
    ecp.keypress.onFirstCall().rejects(new Error('boom'));

    const outcome = run(ecp, makeScript([
      { kind: 'press', key: 'Home' },
      { kind: 'press', key: 'Select' },
    ])).then(() => 'resolved', (err: Error) => err);

    const err = await outcome;
    expect(err).to.be.instanceOf(RaspStepError);
    expect(ecp.keypress.callCount).to.equal(1);
  });

  it('aborting mid-pause rejects with AbortError', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();
    const abort = new AbortController();

    const outcome = run(ecp, makeScript([{ kind: 'pause', seconds: 60 }]), undefined, abort.signal)
      .then(() => 'resolved', (err: Error) => err);

    await clock.tickAsync(100);
    abort.abort();
    await clock.tickAsync(0);

    const err = await outcome;
    expect((err as Error).name).to.equal('AbortError');
  });

  it('aborting mid-poll rejects with AbortError and stops polling', async () => {
    const clock = sinon.useFakeTimers();
    const ecp = makeEcp();
    ecp.queryMediaPlayer.resolves({ state: 'pause', error: false });
    const abort = new AbortController();

    const runner = new RaspRunner(ecp as unknown as EcpClient);
    const outcome = runner.run(
      makeScript([{ kind: 'wait_for_player_state', state: 'play' }]),
      TARGET,
      { signal: abort.signal, pollIntervalMs: 10, waitTimeoutSec: 600 },
    ).then(() => 'resolved', (err: Error) => err);

    await clock.tickAsync(35);
    const callsAtAbort = ecp.queryMediaPlayer.callCount;
    abort.abort();
    await clock.tickAsync(100);

    const err = await outcome;
    expect((err as Error).name).to.equal('AbortError');
    expect(ecp.queryMediaPlayer.callCount).to.equal(callsAtAbort);
  });
});

describe('countSteps / labelOf', () => {
  it('counts flattened steps with nested loops multiplied', () => {
    expect(countSteps([
      { kind: 'press', key: 'Home' },
      { kind: 'loop', iterations: 3, steps: [
        { kind: 'press', key: 'Down' },
        { kind: 'loop', iterations: 2, steps: [{ kind: 'press', key: 'Right' }] },
      ] },
    ])).to.equal(1 + 3 * (1 + 2));
  });

  it('labels steps for progress reporting', () => {
    expect(labelOf({ kind: 'press', key: 'Home' })).to.equal('press Home');
    expect(labelOf({ kind: 'pause', seconds: 2 })).to.equal('pause 2s');
    expect(labelOf({ kind: 'text', text: 'a'.repeat(40) })).to.include('…');
    expect(labelOf({ kind: 'launch', channelName: 'Dev', channelId: 'dev' })).to.equal('launch Dev');
  });
});
