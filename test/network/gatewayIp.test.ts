import { expect } from 'chai';
import * as os from 'os';
import { findGatewayIp } from '../../src/client/network/discovery/gatewayIp';

function ifaces(list: Array<Partial<os.NetworkInterfaceInfo> & { address: string }>): NodeJS.Dict<os.NetworkInterfaceInfo[]> {
  return {
    eth0: list.map((l) => ({
      family: 'IPv4',
      internal: false,
      netmask: '255.255.255.0',
      mac: '00:00:00:00:00:00',
      cidr: null,
      ...l,
    })) as unknown as os.NetworkInterfaceInfo[],
  };
}

describe('network/discovery/findGatewayIp', () => {
  it('returns the host IP on the same subnet as the device', () => {
    const found = findGatewayIp('192.168.137.46', ifaces([{ address: '192.168.137.1' }]));
    expect(found).to.equal('192.168.137.1');
  });

  it('ignores internal and IPv6 interfaces and unmatched subnets', () => {
    const found = findGatewayIp('192.168.137.46', ifaces([
      { address: '127.0.0.1', internal: true },
      { address: 'fe80::1', family: 'IPv6' },
      { address: '10.0.0.5' },
    ]));
    expect(found).to.equal(undefined);
  });
});
