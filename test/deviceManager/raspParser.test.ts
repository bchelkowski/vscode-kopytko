import { expect } from 'chai';
import { ecpKeyToRaspKey, parseRasp, raspKeyToEcpKey, raspQuote } from '../../src/client/deviceManager/rasp/raspParser';
import type { RaspStep } from '../../src/client/deviceManager/rasp/raspTypes';

describe('parseRasp', () => {
  it('parses a full script with params, channels and every command type', () => {
    const source = [
      'params:',
      '    rasp_version: 1',
      '    default_keypress_wait: 3',
      'channels:',
      "    'My Test Channel': 12345",
      'steps:',
      '    - press: home',
      '    - pause: 2',
      '    - launch:',
      '        channel_name: My Test Channel',
      '        content_id: abc-1',
      '        media_type: movie',
      '        timeout: 35',
      '    - text: developer',
      '    - wait_for_player_state: play',
      '    - validate_streaming:',
      '        audio_codec: ac3',
      '        video_codec: mpeg4_2',
      '        drm: aes-128',
      '    - loop:',
      '        iterations: 2',
      '        steps:',
      '        - press: down',
    ].join('\n');

    const { script, errors } = parseRasp(source);

    expect(errors).to.deep.equal([]);
    expect(script).to.not.be.undefined;
    expect(script!.raspVersion).to.equal(1);
    expect(script!.defaultKeypressWaitSec).to.equal(3);
    expect(script!.channels).to.deep.equal({ 'My Test Channel': '12345' });
    expect(script!.steps.map((s) => s.kind)).to.deep.equal([
      'press', 'pause', 'launch', 'text', 'wait_for_player_state', 'validate_streaming', 'loop',
    ]);

    const launch = script!.steps[2] as Extract<RaspStep, { kind: 'launch' }>;
    expect(launch).to.deep.include({
      channelName: 'My Test Channel', channelId: '12345',
      contentId: 'abc-1', mediaType: 'movie', timeoutSec: 35,
    });

    const validate = script!.steps[5] as Extract<RaspStep, { kind: 'validate_streaming' }>;
    expect(validate).to.deep.include({ audioCodec: 'ac3', videoCodec: 'mpeg4_2', drm: 'aes-128' });

    const loop = script!.steps[6] as Extract<RaspStep, { kind: 'loop' }>;
    expect(loop.iterations).to.equal(2);
    expect(loop.steps).to.deep.equal([{ kind: 'press', key: 'Down' }]);
  });

  it('defaults rasp_version to 1 and default_keypress_wait to 2 when params is absent', () => {
    const { script, errors } = parseRasp('steps:\n    - press: up');
    expect(errors).to.deep.equal([]);
    expect(script!.raspVersion).to.equal(1);
    expect(script!.defaultKeypressWaitSec).to.equal(2);
  });

  it('resolves reusable step blocks via YAML anchors/aliases, inlined at each replay site', () => {
    const source = [
      'steps:',
      '    - step: &nav',
      '        - press: up',
      '        - press: right',
      '    - press: home',
      '    - *nav',
      '    - *nav',
    ].join('\n');

    const { script, errors } = parseRasp(source);

    expect(errors).to.deep.equal([]);
    // The definition itself is a no-op; each alias inlines both presses.
    expect(script!.steps).to.deep.equal([
      { kind: 'press', key: 'Home' },
      { kind: 'press', key: 'Up' },
      { kind: 'press', key: 'Right' },
      { kind: 'press', key: 'Up' },
      { kind: 'press', key: 'Right' },
    ]);
  });

  it('parses nested loops', () => {
    const source = [
      'steps:',
      '    - loop:',
      '        iterations: 3',
      '        steps:',
      '        - loop:',
      '            iterations: 2',
      '            steps:',
      '            - press: left',
    ].join('\n');

    const { script, errors } = parseRasp(source);
    expect(errors).to.deep.equal([]);
    const outer = script!.steps[0] as Extract<RaspStep, { kind: 'loop' }>;
    const inner = outer.steps[0] as Extract<RaspStep, { kind: 'loop' }>;
    expect(inner.iterations).to.equal(2);
    expect(inner.steps).to.deep.equal([{ kind: 'press', key: 'Left' }]);
  });

  it('accepts launch with a direct channel_id and no channels section', () => {
    const { script, errors } = parseRasp('steps:\n    - launch:\n        channel_id: dev');
    expect(errors).to.deep.equal([]);
    expect(script!.steps[0]).to.deep.include({ kind: 'launch', channelId: 'dev' });
  });

  it('reports YAML syntax errors with a line number', () => {
    const { script, errors } = parseRasp('steps:\n    - press: [unclosed');
    expect(script).to.be.undefined;
    expect(errors).to.have.length(1);
    expect(errors[0].line).to.be.a('number');
  });

  it('reports an unknown press key with its step path', () => {
    const { script, errors } = parseRasp('steps:\n    - press: warp');
    expect(script).to.be.undefined;
    expect(errors[0].message).to.include('warp');
    expect(errors[0].path).to.equal('steps[0]');
  });

  it('reports an unknown command with its step path', () => {
    const { script, errors } = parseRasp('steps:\n    - teleport: home');
    expect(script).to.be.undefined;
    expect(errors[0].message).to.include('teleport');
  });

  it('rejects a launch whose channel_name is not in the channels map', () => {
    const { script, errors } = parseRasp('steps:\n    - launch:\n        channel_name: Ghost');
    expect(script).to.be.undefined;
    expect(errors[0].message).to.include('Ghost');
  });

  it('rejects an invalid wait_for_player_state value', () => {
    const { errors } = parseRasp('steps:\n    - wait_for_player_state: buffering');
    expect(errors[0].message).to.include('buffering');
  });

  it('rejects negative pause and non-integer loop iterations', () => {
    expect(parseRasp('steps:\n    - pause: -1').errors).to.have.length(1);
    expect(parseRasp('steps:\n    - loop:\n        iterations: 1.5\n        steps:\n        - press: up').errors).to.have.length(1);
  });

  it('rejects an unsupported rasp_version', () => {
    const { errors } = parseRasp('params:\n    rasp_version: 2\nsteps:\n    - press: up');
    expect(errors[0].message).to.include('rasp_version');
  });

  it('rejects an empty script and a missing steps section', () => {
    expect(parseRasp('').errors).to.have.length(1);
    expect(parseRasp('params:\n    rasp_version: 1').errors[0].message).to.include('steps');
  });

  it('coerces numeric text values to strings', () => {
    const { script } = parseRasp('steps:\n    - text: 1234');
    expect(script!.steps[0]).to.deep.equal({ kind: 'text', text: '1234' });
  });
});

describe('raspKeyToEcpKey', () => {
  it('maps RASP lowercase names to ECP keys', () => {
    expect(raspKeyToEcpKey('home')).to.equal('Home');
    expect(raspKeyToEcpKey('reverse')).to.equal('Rev');
    expect(raspKeyToEcpKey('forward')).to.equal('Fwd');
    expect(raspKeyToEcpKey('replay')).to.equal('InstantReplay');
    expect(raspKeyToEcpKey('ok')).to.equal('Select');
    expect(raspKeyToEcpKey('HOME')).to.equal('Home');
  });

  it('passes Lit_ keys through unchanged', () => {
    expect(raspKeyToEcpKey('Lit_%E2%82%AC')).to.equal('Lit_%E2%82%AC');
  });

  it('returns undefined for unknown keys', () => {
    expect(raspKeyToEcpKey('warp')).to.be.undefined;
  });
});

describe('ecpKeyToRaspKey (remote-to-script recording)', () => {
  it('maps ECP keys to canonical RASP press names', () => {
    expect(ecpKeyToRaspKey('Home')).to.equal('home');
    expect(ecpKeyToRaspKey('InstantReplay')).to.equal('replay');
    expect(ecpKeyToRaspKey('Select')).to.equal('select');
    expect(ecpKeyToRaspKey('Rev')).to.equal('rev');
    expect(ecpKeyToRaspKey('Fwd')).to.equal('fwd');
  });

  it('round-trips through the RASP parser', () => {
    for (const ecpKey of ['Home', 'Up', 'Down', 'Left', 'Right', 'Select', 'Back', 'InstantReplay', 'Info', 'Play', 'Rev', 'Fwd']) {
      const rasp = ecpKeyToRaspKey(ecpKey);
      expect(rasp, ecpKey).to.be.a('string');
      expect(raspKeyToEcpKey(rasp!), `${ecpKey} → ${rasp}`).to.equal(ecpKey);
    }
  });

  it('passes Lit_ keys through and returns undefined for unknowns', () => {
    expect(ecpKeyToRaspKey('Lit_a')).to.equal('Lit_a');
    expect(ecpKeyToRaspKey('NotAKey')).to.be.undefined;
  });
});

describe('raspQuote', () => {
  it('leaves plain text unquoted and parseable back to itself', () => {
    expect(raspQuote('developer')).to.equal('developer');
    expect(raspQuote('two words')).to.equal('two words');
  });

  it('quotes values YAML would misinterpret', () => {
    expect(raspQuote('a: b')).to.equal("'a: b'");
    expect(raspQuote('true')).to.equal("'true'");
    expect(raspQuote('1234')).to.equal("'1234'");
    expect(raspQuote('- dash')).to.equal("'- dash'");
    expect(raspQuote(' padded ')).to.equal("' padded '");
    expect(raspQuote('')).to.equal("''");
  });

  it('escapes embedded single quotes', () => {
    expect(raspQuote("it's")).to.equal("'it''s'");
  });

  it('every quoted value parses back to the original through a text step', () => {
    for (const text of ['plain', 'a: b', "it's", '1234', ' padded ', 'true', '- dash', 'zażółć €']) {
      const { script, errors } = parseRasp(`steps:\n    - text: ${raspQuote(text)}`);
      expect(errors, text).to.deep.equal([]);
      expect(script!.steps[0]).to.deep.equal({ kind: 'text', text });
    }
  });
});
