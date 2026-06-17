import { expect } from 'chai';
import {
  BRIGHTSCRIPT_COMPONENTS,
  BRIGHTSCRIPT_INTERFACES,
  findInterface,
  getComponentMethods,
  findMethodInterface,
  CATALOG_LAST_VERIFIED,
} from 'brightscript-parser';

describe('BrightScript component catalog', () => {

  // ── Catalog integrity ──────────────────────────────────────────────────────

  describe('BRIGHTSCRIPT_COMPONENTS', () => {
    it('contains the essential core components', () => {
      const names = BRIGHTSCRIPT_COMPONENTS.map((c) => c.name);
      expect(names).to.include.members([
        'roArray', 'roAssociativeArray', 'roString', 'roByteArray',
        'roList', 'roXMLElement', 'roDateTime', 'roTimespan',
        'roUrlTransfer', 'roMessagePort', 'roFileSystem',
        'roDeviceInfo', 'roAppInfo', 'roRegistry', 'roRegistrySection',
        'roSGNode', 'roSGScreen', 'roAudioPlayer',
        'roRenderThreadQueue',
      ]);
    });

    it('every component has a non-empty name, description, docsUrl, and interfaces array', () => {
      for (const c of BRIGHTSCRIPT_COMPONENTS) {
        expect(c.name, 'name').to.be.a('string').that.is.not.empty;
        expect(c.description, `description for ${c.name}`).to.be.a('string').that.is.not.empty;
        expect(c.docsUrl, `docsUrl for ${c.name}`).to.match(/^https:\/\/developer\.roku\.com/);
        expect(c.interfaces, `interfaces for ${c.name}`).to.be.an('array').that.is.not.empty;
      }
    });

    it('has no duplicate component names', () => {
      const names = BRIGHTSCRIPT_COMPONENTS.map((c) => c.name.toLowerCase());
      expect(new Set(names).size).to.equal(names.length);
    });

    it('every referenced interface name exists in BRIGHTSCRIPT_INTERFACES', () => {
      const knownInterfaces = new Set(Object.keys(BRIGHTSCRIPT_INTERFACES).map((k) => k.toLowerCase()));
      for (const c of BRIGHTSCRIPT_COMPONENTS) {
        for (const iface of c.interfaces) {
          expect(
            knownInterfaces.has(iface.toLowerCase()),
            `Component ${c.name} references unknown interface ${iface}`
          ).to.be.true;
        }
      }
    });
  });

  // ── Interface integrity ────────────────────────────────────────────────────

  describe('BRIGHTSCRIPT_INTERFACES', () => {
    it('every interface has a non-empty name, description, and methods array', () => {
      for (const [key, iface] of Object.entries(BRIGHTSCRIPT_INTERFACES)) {
        expect(iface.name, `name for ${key}`).to.be.a('string').that.is.not.empty;
        expect(iface.description, `description for ${key}`).to.be.a('string').that.is.not.empty;
        expect(iface.methods, `methods for ${key}`).to.be.an('array').that.is.not.empty;
      }
    });

    it('every method has name, signature, returnType, and description', () => {
      for (const iface of Object.values(BRIGHTSCRIPT_INTERFACES)) {
        for (const m of iface.methods) {
          expect(m.name, `method name in ${iface.name}`).to.be.a('string').that.is.not.empty;
          expect(m.signature, `signature in ${iface.name}.${m.name}`).to.be.a('string').that.is.not.empty;
          expect(m.returnType, `returnType in ${iface.name}.${m.name}`).to.be.a('string').that.is.not.empty;
          expect(m.description, `description in ${iface.name}.${m.name}`).to.be.a('string').that.is.not.empty;
        }
      }
    });

    it('method signatures contain the method name', () => {
      for (const iface of Object.values(BRIGHTSCRIPT_INTERFACES)) {
        for (const m of iface.methods) {
          expect(
            m.signature,
            `signature for ${iface.name}.${m.name} should contain the method name`
          ).to.include(m.name);
        }
      }
    });
  });

  // ── findInterface ──────────────────────────────────────────────────────────

  describe('findInterface', () => {
    it('finds ifArray', () => {
      const iface = findInterface('ifArray');
      expect(iface).to.not.be.undefined;
      expect(iface!.methods.map((m) => m.name)).to.include.members(['Push', 'Pop', 'Peek', 'Count', 'Clear']);
    });

    it('is case-insensitive', () => {
      expect(findInterface('IFARRAY')).to.not.be.undefined;
    });

    it('returns undefined for unknown interface', () => {
      expect(findInterface('ifNonExistent')).to.be.undefined;
    });
  });

  // ── getComponentMethods ───────────────────────────────────────────────────

  describe('getComponentMethods', () => {
    it('returns all methods for roArray across multiple interfaces', () => {
      const methods = getComponentMethods('roArray');
      const names = methods.map((m) => m.name);
      // ifArray
      expect(names).to.include.members(['Push', 'Pop', 'Peek', 'Count', 'Clear', 'Append']);
      // ifArraySort
      expect(names).to.include.members(['Sort', 'SortBy', 'Reverse']);
      // ifArrayJoin
      expect(names).to.include('Join');
      // ifArraySlice
      expect(names).to.include('Slice');
    });

    it('returns no duplicate method names', () => {
      const methods = getComponentMethods('roArray');
      const names = methods.map((m) => m.name.toLowerCase());
      expect(new Set(names).size).to.equal(names.length);
    });

    it('returns methods for roAssociativeArray', () => {
      const methods = getComponentMethods('roAssociativeArray');
      const names = methods.map((m) => m.name);
      expect(names).to.include.members(['AddReplace', 'Delete', 'DoesExist', 'Lookup', 'Keys', 'Values', 'Count']);
    });

    it('returns methods for roUrlTransfer', () => {
      const methods = getComponentMethods('roUrlTransfer');
      const names = methods.map((m) => m.name);
      expect(names).to.include.members(['GetToString', 'AsyncGetToString', 'PostFromString', 'SetUrl', 'GetResponseCode', 'AddHeader']);
    });

    it('returns methods for roSGNode', () => {
      const methods = getComponentMethods('roSGNode');
      const names = methods.map((m) => m.name);
      expect(names).to.include.members(['FindNode', 'SetField', 'GetField', 'ObserveField', 'CallFunc', 'SetFocus']);
    });

    it('returns methods for roDeviceInfo', () => {
      const methods = getComponentMethods('roDeviceInfo');
      const names = methods.map((m) => m.name);
      expect(names).to.include.members(['GetModel', 'GetVersion', 'GetRIDA', 'GetConnectionType', 'HasFeature']);
    });

    it('returns methods for roRenderThreadQueue', () => {
      const methods = getComponentMethods('roRenderThreadQueue');
      const names = methods.map((m) => m.name);
      expect(names).to.include.members(['AddMessageHandler', 'PostMessage', 'CopyMessage', 'NumCopies']);
    });

    it('returns empty array for unknown component', () => {
      expect(getComponentMethods('roNonExistent')).to.be.empty;
    });
  });

  // ── findMethodInterface ───────────────────────────────────────────────────

  describe('findMethodInterface', () => {
    it('identifies ifArray as the interface defining Push on roArray', () => {
      const iface = findMethodInterface('roArray', 'Push');
      expect(iface).to.not.be.undefined;
      expect(iface!.name).to.equal('ifArray');
    });

    it('identifies ifArraySort as the interface defining Sort on roArray', () => {
      const iface = findMethodInterface('roArray', 'Sort');
      expect(iface!.name).to.equal('ifArraySort');
    });

    it('identifies ifAssociativeArray for Lookup on roAssociativeArray', () => {
      const iface = findMethodInterface('roAssociativeArray', 'Lookup');
      expect(iface!.name).to.equal('ifAssociativeArray');
    });

    it('returns undefined for a method that does not exist on the component', () => {
      expect(findMethodInterface('roArray', 'GetToString')).to.be.undefined;
    });

    it('returns undefined for an unknown component', () => {
      expect(findMethodInterface('roNonExistent', 'Push')).to.be.undefined;
    });
  });

  // ── CATALOG_LAST_VERIFIED ─────────────────────────────────────────────────

  describe('CATALOG_LAST_VERIFIED', () => {
    it('is a date string in YYYY-MM-DD format', () => {
      expect(CATALOG_LAST_VERIFIED).to.match(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('is a plausible recent date (not before 2024)', () => {
      const year = parseInt(CATALOG_LAST_VERIFIED.slice(0, 4), 10);
      expect(year).to.be.at.least(2024);
    });
  });
});
