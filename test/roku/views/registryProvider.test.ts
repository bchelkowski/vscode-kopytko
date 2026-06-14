import '../vscode-mock';
import { expect } from 'chai';
import {
  parseRegistryXml,
  formatRegistryAsJson,
} from '../../../src/client/roku/views/registryProvider';

// ---------------------------------------------------------------------------
// parseRegistryXml
// ---------------------------------------------------------------------------

describe('parseRegistryXml', () => {
  const FULL_XML = [
    '<plugin-registry>',
    '  <registry>',
    '    <dev-id>e090ac01d342483bb28831a7e1afff8e</dev-id>',
    '    <plugins>dev</plugins>',
    '    <space-available>9168</space-available>',
    '    <sections>',
    '      <section>',
    '        <name>UserInfo</name>',
    '        <items>',
    '          <item>',
    '            <key>NextPaymentDate</key>',
    '            <value>2022-09-17T17:17:55</value>',
    '          </item>',
    '          <item>',
    '            <key>UserId</key>',
    '            <value>1429492</value>',
    '          </item>',
    '        </items>',
    '      </section>',
    '      <section>',
    '        <name>Settings</name>',
    '        <items>',
    '          <item>',
    '            <key>Theme</key>',
    '            <value>dark</value>',
    '          </item>',
    '        </items>',
    '      </section>',
    '    </sections>',
    '  </registry>',
    '  <status>OK</status>',
    '</plugin-registry>',
  ].join('\n');

  it('extracts dev-id, plugins, and space-available', () => {
    const data = parseRegistryXml(FULL_XML);

    expect(data.devId).to.equal('e090ac01d342483bb28831a7e1afff8e');
    expect(data.plugins).to.equal('dev');
    expect(data.spaceAvailable).to.equal('9168');
  });

  it('parses all sections', () => {
    const data = parseRegistryXml(FULL_XML);

    expect(data.sections).to.have.length(2);
    expect(data.sections[0].name).to.equal('UserInfo');
    expect(data.sections[1].name).to.equal('Settings');
  });

  it('parses items within sections', () => {
    const data = parseRegistryXml(FULL_XML);

    const userInfo = data.sections[0];
    expect(userInfo.items).to.have.length(2);
    expect(userInfo.items[0]).to.deep.equal({ key: 'NextPaymentDate', value: '2022-09-17T17:17:55' });
    expect(userInfo.items[1]).to.deep.equal({ key: 'UserId', value: '1429492' });

    const settings = data.sections[1];
    expect(settings.items).to.have.length(1);
    expect(settings.items[0]).to.deep.equal({ key: 'Theme', value: 'dark' });
  });

  it('handles empty registry (no sections)', () => {
    const xml = '<plugin-registry><registry><sections></sections></registry></plugin-registry>';
    const data = parseRegistryXml(xml);

    expect(data.sections).to.have.length(0);
  });

  it('handles section with no items', () => {
    const xml = [
      '<plugin-registry><registry><sections>',
      '<section><name>Empty</name><items></items></section>',
      '</sections></registry></plugin-registry>',
    ].join('');
    const data = parseRegistryXml(xml);

    expect(data.sections).to.have.length(1);
    expect(data.sections[0].name).to.equal('Empty');
    expect(data.sections[0].items).to.have.length(0);
  });

  it('handles item with empty value', () => {
    const xml = [
      '<plugin-registry><registry><sections>',
      '<section><name>S</name><items>',
      '<item><key>token</key><value></value></item>',
      '</items></section>',
      '</sections></registry></plugin-registry>',
    ].join('');
    const data = parseRegistryXml(xml);

    expect(data.sections[0].items[0]).to.deep.equal({ key: 'token', value: '' });
  });

  it('parses FAILED status from access-denied response', () => {
    const xml = [
      '<plugin-registry>',
      '  <status>FAILED</status>',
      '  <error>Specified dev ID does not match the device key</error>',
      '</plugin-registry>',
    ].join('\n');
    const data = parseRegistryXml(xml);

    expect(data.status).to.equal('FAILED');
    expect(data.error).to.equal('Specified dev ID does not match the device key');
    expect(data.sections).to.have.length(0);
  });

  it('returns undefined status for successful responses', () => {
    const xml = '<plugin-registry><registry><sections></sections></registry><status>OK</status></plugin-registry>';
    const data = parseRegistryXml(xml);

    expect(data.status).to.equal('OK');
    expect(data.error).to.be.undefined;
  });

  it('returns undefined status and error when tags are absent', () => {
    const xml = '<plugin-registry><registry><sections></sections></registry></plugin-registry>';
    const data = parseRegistryXml(xml);

    expect(data.status).to.be.undefined;
    expect(data.error).to.be.undefined;
  });
});

// ---------------------------------------------------------------------------
// formatRegistryAsJson
// ---------------------------------------------------------------------------

describe('formatRegistryAsJson', () => {
  it('produces valid JSON with all fields', () => {
    const data = {
      devId: 'abc123',
      plugins: 'dev',
      spaceAvailable: '5000',
      sections: [
        { name: 'Auth', items: [{ key: 'token', value: 'xyz' }] },
      ],
    };

    const json = formatRegistryAsJson(data, 'dev', 'My Roku');
    const parsed = JSON.parse(json);

    expect(parsed.device).to.equal('My Roku');
    expect(parsed.channelId).to.equal('dev');
    expect(parsed.devId).to.equal('abc123');
    expect(parsed.spaceAvailable).to.equal('5000 bytes');
    expect(parsed.sections.Auth).to.deep.equal({ token: 'xyz' });
  });

  it('handles empty sections', () => {
    const data = { devId: '', plugins: '', spaceAvailable: '0', sections: [] };
    const json = formatRegistryAsJson(data, 'dev', 'Test');
    const parsed = JSON.parse(json);

    expect(parsed.sections).to.deep.equal({});
  });
});
