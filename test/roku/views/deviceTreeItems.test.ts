import '../vscode-mock';
import { expect } from 'chai';
import { DeviceEnvironmentItem, DeviceTreeItem, DeviceInfoItem } from '../../../src/client/roku/views/deviceTreeItems';
import { RokuDevice } from 'kopytko-roku-device';

function makeDevice(overrides?: Partial<RokuDevice>): RokuDevice {
  return {
    deviceId: 'AA:BB:CC:DD:EE:01',
    ip: '192.168.1.100',
    port: 8060,
    serialNumber: 'SERIAL001',
    friendlyName: 'Test Roku',
    modelName: 'Roku Ultra',
    modelNumber: '4800X',
    softwareVersion: '12.5.0',
    state: 'online',
    source: 'discovered',
    isFavorite: false,
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe('DeviceEnvironmentItem', () => {
  it('shows environment name as description', () => {
    const item = new DeviceEnvironmentItem('SERIAL001', 'staging');
    expect(item.label).to.equal('Environment');
    expect(item.description).to.equal('staging');
  });

  it('shows "(not set)" when environment is undefined', () => {
    const item = new DeviceEnvironmentItem('SERIAL001', undefined);
    expect(item.description).to.equal('(not set)');
  });

  it('has contextValue "deviceEnvironment"', () => {
    const item = new DeviceEnvironmentItem('SERIAL001', 'dev');
    expect(item.contextValue).to.equal('deviceEnvironment');
  });

  it('stores the serial number', () => {
    const item = new DeviceEnvironmentItem('SERIAL123', 'prod');
    expect(item.serialNumber).to.equal('SERIAL123');
  });

  it('has a command to open environment selector', () => {
    const item = new DeviceEnvironmentItem('SERIAL001', 'dev');
    expect(item.command).to.deep.include({
      command: 'kopytko.setDeviceEnvironment',
      arguments: ['SERIAL001'],
    });
  });

  it('has a tooltip when environment is set', () => {
    const item = new DeviceEnvironmentItem('SERIAL001', 'staging');
    expect(item.tooltip).to.include('staging');
  });

  it('has a tooltip when environment is not set', () => {
    const item = new DeviceEnvironmentItem('SERIAL001', undefined);
    expect(item.tooltip).to.include('No environment set');
  });
});

describe('DeviceTreeItem', () => {
  it('shows device name as label', () => {
    const device = makeDevice();
    const item = new DeviceTreeItem(device, false);
    expect(item.label).to.equal('Test Roku');
  });

  it('shows active indicator when active', () => {
    const device = makeDevice();
    const item = new DeviceTreeItem(device, true);
    expect(item.description).to.include('active');
  });

  it('builds contextValue with state flags', () => {
    const device = makeDevice({ isFavorite: true, state: 'online' });
    const item = new DeviceTreeItem(device, true);
    expect(item.contextValue).to.include('rokuDevice');
    expect(item.contextValue).to.include('favorite');
    expect(item.contextValue).to.include('online');
    expect(item.contextValue).to.include('active');
  });
});

describe('DeviceInfoItem', () => {
  it('shows key as label and value as description', () => {
    const item = new DeviceInfoItem('Model', 'Roku Ultra (4800X)');
    expect(item.label).to.equal('Model');
    expect(item.description).to.equal('Roku Ultra (4800X)');
  });

  it('has copy command', () => {
    const item = new DeviceInfoItem('IP', '192.168.1.100');
    expect(item.command?.command).to.equal('kopytko.copyToClipboard');
    expect(item.command?.arguments).to.deep.equal(['192.168.1.100']);
  });
});
