import { expect } from 'chai';
import { findComponent } from '../../src/catalog/components';

describe('BrightScript component catalog', () => {
  describe('findComponent', () => {
    it('finds roArray by exact name', () => {
      const name = findComponent('roArray');
      expect(name).to.not.be.undefined;
      expect(name).to.equal('roArray');
    });

    it('is case-insensitive', () => {
      expect(findComponent('roarray')).to.not.be.undefined;
      expect(findComponent('ROARRAY')).to.not.be.undefined;
    });

    it('returns undefined for an unknown component', () => {
      expect(findComponent('roNonExistent')).to.be.undefined;
    });

    it('finds core components', () => {
      expect(findComponent('roAssociativeArray')).to.equal('roAssociativeArray');
      expect(findComponent('roString')).to.equal('roString');
      expect(findComponent('roByteArray')).to.equal('roByteArray');
      expect(findComponent('roDateTime')).to.equal('roDateTime');
      expect(findComponent('roDeviceInfo')).to.equal('roDeviceInfo');
      expect(findComponent('roSGNode')).to.equal('roSGNode');
      expect(findComponent('roUrlTransfer')).to.equal('roUrlTransfer');
      expect(findComponent('roRegex')).to.equal('roRegex');
    });
  });
});
