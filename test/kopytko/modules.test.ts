import { expect } from 'chai';
import {
  KOPYTKO_MODULES,
  getModuleByPackage,
  findExport,
} from '../../src/server/kopytko/modules';

describe('Kopytko modules', () => {
  describe('KOPYTKO_MODULES', () => {
    it('includes the core framework modules', () => {
      const names = KOPYTKO_MODULES.map((m) => m.name);
      expect(names).to.include.members(['Renderer', 'Router', 'EventBus', 'Store', 'HTTP', 'Cache']);
    });

    it('every module has a name, npmPackage, description, and exports array', () => {
      for (const mod of KOPYTKO_MODULES) {
        expect(mod.name, 'name').to.be.a('string').that.is.not.empty;
        expect(mod.npmPackage, `npmPackage for ${mod.name}`).to.be.a('string').that.is.not.empty;
        expect(mod.description, `description for ${mod.name}`).to.be.a('string').that.is.not.empty;
        expect(mod.exports, `exports for ${mod.name}`).to.be.an('array');
      }
    });

    it('every export has a name, kind, and description', () => {
      for (const mod of KOPYTKO_MODULES) {
        for (const exp of mod.exports) {
          expect(exp.name, `export name in ${mod.name}`).to.be.a('string').that.is.not.empty;
          expect(exp.kind, `export kind in ${mod.name}`).to.be.oneOf(['function', 'sub', 'component']);
          expect(exp.description, `export description in ${mod.name}`).to.be.a('string').that.is.not.empty;
        }
      }
    });
  });

  describe('getModuleByPackage', () => {
    it('returns the module for a known package name', () => {
      const mod = getModuleByPackage('@dazn/kopytko-framework');
      expect(mod).to.not.be.undefined;
      expect(mod!.name).to.be.a('string').that.is.not.empty;
    });

    it('returns undefined for an unknown package', () => {
      expect(getModuleByPackage('@unknown/package')).to.be.undefined;
    });
  });

  describe('findExport', () => {
    it('finds setState in the Renderer module', () => {
      const result = findExport('setState');
      expect(result).to.not.be.undefined;
      expect(result!.module.name).to.equal('Renderer');
      expect(result!.export.kind).to.equal('sub');
    });

    it('finds navigate in the Router module', () => {
      const result = findExport('navigate');
      expect(result).to.not.be.undefined;
      expect(result!.module.name).to.equal('Router');
    });

    it('is case-insensitive', () => {
      const lower = findExport('setstate');
      const upper = findExport('SETSTATE');
      expect(lower).to.not.be.undefined;
      expect(upper).to.not.be.undefined;
      expect(lower!.export.name).to.equal(upper!.export.name);
    });

    it('returns undefined for unknown export names', () => {
      expect(findExport('nonExistentFunction')).to.be.undefined;
    });

    it('finds emit in the EventBus module', () => {
      const result = findExport('emit');
      expect(result).to.not.be.undefined;
      expect(result!.module.name).to.equal('EventBus');
    });
  });
});
