import { expect } from 'chai';
import { SG_NODES, findSgNode, getAllSgNodeFields, getAllSgNodeMethods } from '../../src/server/brightscript/sgNodes';

describe('sgNodes', () => {
  describe('catalog structure', () => {
    it('Node is present', () => {
      expect(SG_NODES['Node']).to.exist;
    });

    it('Group extends Node', () => {
      expect(SG_NODES['Group'].extends).to.equal('Node');
    });

    it('LayoutGroup extends Group', () => {
      expect(SG_NODES['LayoutGroup'].extends).to.equal('Group');
    });

    it('every entry has a name, description, docsUrl, fields array, and methods array', () => {
      for (const [key, def] of Object.entries(SG_NODES)) {
        expect(def.name, `${key}.name`).to.be.a('string').that.is.not.empty;
        expect(def.description, `${key}.description`).to.be.a('string').that.is.not.empty;
        expect(def.docsUrl, `${key}.docsUrl`).to.be.a('string').that.is.not.empty;
        expect(def.fields, `${key}.fields`).to.be.an('array');
        expect(def.methods, `${key}.methods`).to.be.an('array');
      }
    });

    it('every extends reference points to an existing node', () => {
      for (const [key, def] of Object.entries(SG_NODES)) {
        if (def.extends) {
          expect(SG_NODES[def.extends], `${key}.extends="${def.extends}"`).to.exist;
        }
      }
    });

    it('Node has observeFieldScoped method', () => {
      const node = SG_NODES['Node'];
      expect(node.methods.map((m) => m.name)).to.include('observeFieldScoped');
    });

    it('Node has observeField method', () => {
      expect(SG_NODES['Node'].methods.map((m) => m.name)).to.include('observeField');
    });

    it('Node has findNode method', () => {
      expect(SG_NODES['Node'].methods.map((m) => m.name)).to.include('findNode');
    });

    it('every method has signature, returnType, interface, and description', () => {
      for (const [key, def] of Object.entries(SG_NODES)) {
        for (const m of def.methods) {
          expect(m.signature, `${key}.${m.name}.signature`).to.be.a('string').that.is.not.empty;
          expect(m.returnType, `${key}.${m.name}.returnType`).to.be.a('string').that.is.not.empty;
          expect(m.interface, `${key}.${m.name}.interface`).to.be.a('string').that.is.not.empty;
          expect(m.description, `${key}.${m.name}.description`).to.be.a('string').that.is.not.empty;
        }
      }
    });
  });

  describe('findSgNode', () => {
    it('returns the definition for a known node', () => {
      const def = findSgNode('Group');
      expect(def).to.exist;
      expect(def?.name).to.equal('Group');
    });

    it('returns undefined for an unknown node', () => {
      expect(findSgNode('UnknownNode')).to.be.undefined;
    });
  });

  describe('getAllSgNodeFields', () => {
    it('returns own fields for Node', () => {
      const fields = getAllSgNodeFields('Node');
      const names = fields.map((f) => f.name);
      expect(names).to.include('id');
      expect(names).to.include('focusable');
    });

    it('Group fields include own fields', () => {
      const fields = getAllSgNodeFields('Group');
      const names = fields.map((f) => f.name);
      expect(names).to.include('visible');
      expect(names).to.include('opacity');
    });

    it('Group fields include inherited Node fields', () => {
      const fields = getAllSgNodeFields('Group');
      const names = fields.map((f) => f.name);
      expect(names).to.include('id');
      expect(names).to.include('focusable');
    });

    it('LayoutGroup fields include own, Group, and Node fields', () => {
      const fields = getAllSgNodeFields('LayoutGroup');
      const names = fields.map((f) => f.name);
      expect(names).to.include('layoutDirection');
      expect(names).to.include('visible');
      expect(names).to.include('id');
    });

    it('returns empty array for unknown node', () => {
      expect(getAllSgNodeFields('UnknownNode')).to.deep.equal([]);
    });

    it('does not loop infinitely on non-existent extends', () => {
      expect(() => getAllSgNodeFields('Node')).to.not.throw();
    });
  });

  describe('getAllSgNodeMethods', () => {
    it('Node has observeFieldScoped in its methods', () => {
      const methods = getAllSgNodeMethods('Node');
      expect(methods.map((m) => m.name)).to.include('observeFieldScoped');
    });

    it('Group inherits Node methods', () => {
      const methods = getAllSgNodeMethods('Group');
      const names = methods.map((m) => m.name);
      expect(names).to.include('observeField');
      expect(names).to.include('findNode');
      expect(names).to.include('setFocus');
    });

    it('LayoutGroup inherits Group and Node methods', () => {
      const methods = getAllSgNodeMethods('LayoutGroup');
      expect(methods.map((m) => m.name)).to.include('observeFieldScoped');
    });

    it('returns empty array for unknown node', () => {
      expect(getAllSgNodeMethods('UnknownNode')).to.deep.equal([]);
    });
  });
});
