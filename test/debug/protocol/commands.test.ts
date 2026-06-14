import { expect } from 'chai';
import { BinaryWriter } from '../../../src/client/debug/protocol/binaryIO';
import { VariableFlags, VariableType, VariableRequestFlags } from '../../../src/client/debug/protocol/constants';

/**
 * Build a binary variable entry matching the Roku debug protocol wire format.
 *
 * Field order per the Roku spec:
 *   uint8   flags
 *   uint8   variable_type
 *   utf8z   name            (if IS_NAME_HERE)
 *   uint32  ref_count       (if IS_REF_COUNTED)
 *   uint8   key_type        (if IS_CONTAINER)
 *   uint32  element_count   (if IS_CONTAINER)
 *   <value>                 (if IS_VALUE_HERE)
 */
function writeVariableEntry(
  writer: BinaryWriter,
  opts: {
    flags: number;
    type: VariableType;
    name?: string;
    refCount?: number;
    keyType?: VariableType;
    childCount?: number;
    stringValue?: string;
    intValue?: number;
  },
): void {
  writer.writeUint8(opts.flags);
  writer.writeUint8(opts.type);

  if (opts.flags & VariableFlags.IsNameHere) {
    writer.writeStringNT(opts.name ?? '');
  }
  if (opts.flags & VariableFlags.IsRefCounted) {
    writer.writeUint32(opts.refCount ?? 1);
  }
  if (opts.flags & VariableFlags.IsContainer) {
    writer.writeUint8(opts.keyType ?? VariableType.String);
    writer.writeUint32(opts.childCount ?? 0);
  }
  if (opts.flags & VariableFlags.IsValueHere) {
    if (opts.type === VariableType.String) {
      writer.writeStringNT(opts.stringValue ?? '');
    } else if (opts.type === VariableType.Integer) {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(opts.intValue ?? 0);
      writer.writeBuffer(buf);
    }
  }
}

// We test the static parsing method via a wrapper that calls the private method
// through the public getVariables() path. Since getVariables() sends a network
// request, we test _parseVariables indirectly by building the exact binary
// format and calling the parser.

// Access the private static method for unit testing
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DebugCommands } = require('../../../src/client/debug/protocol/commands');

describe('DebugCommands — variable parsing', () => {
  describe('_parseVariables (via static access)', () => {
    // The parser is private static — access it for testing
    const parseVariables = (payload: Buffer) => {
      return DebugCommands['_parseVariables'](payload);
    };

    it('parses a simple string variable', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(1); // variableCount = 1

      const flags = VariableFlags.IsNameHere | VariableFlags.IsValueHere;
      writeVariableEntry(writer, {
        flags,
        type: VariableType.String,
        name: 'greeting',
        stringValue: 'hello',
      });

      const result = parseVariables(writer.toBuffer());
      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('greeting');
      expect(result[0].type).to.equal(VariableType.String);
      expect(result[0].value).to.equal('hello');
      expect(result[0].isContainer).to.be.false;
      expect(result[0].isChildKey).to.be.false;
      expect(result[0].isVirtual).to.be.false;
    });

    it('parses isVirtual flag for SceneGraph node fields', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(1);

      const flags = VariableFlags.IsNameHere | VariableFlags.IsValueHere
        | VariableFlags.IsChildKey | VariableFlags.IsVirtual;
      writeVariableEntry(writer, {
        flags,
        type: VariableType.String,
        name: 'id',
        stringValue: 'myButton',
      });

      const result = parseVariables(writer.toBuffer());
      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('id');
      expect(result[0].isVirtual).to.be.true;
      expect(result[0].isChildKey).to.be.true;
    });

    it('parses a container with isVirtual flag (node field that is a container)', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(1);

      const flags = VariableFlags.IsNameHere | VariableFlags.IsContainer
        | VariableFlags.IsChildKey | VariableFlags.IsVirtual;
      writeVariableEntry(writer, {
        flags,
        type: VariableType.Array,
        name: 'translation',
        keyType: VariableType.Integer,
        childCount: 2,
      });

      const result = parseVariables(writer.toBuffer());
      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('translation');
      expect(result[0].isContainer).to.be.true;
      expect(result[0].isVirtual).to.be.true;
      expect(result[0].childCount).to.equal(2);
      expect(result[0].keyType).to.equal(VariableType.Integer);
    });

    it('parses a SubtypedObject node variable (non-virtual at top level)', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(1);

      const flags = VariableFlags.IsNameHere | VariableFlags.IsContainer
        | VariableFlags.IsRefCounted;
      writeVariableEntry(writer, {
        flags,
        type: VariableType.SubtypedObject,
        name: 'myNode',
        refCount: 3,
        keyType: VariableType.String,
        childCount: 5,
      });

      const result = parseVariables(writer.toBuffer());
      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('myNode');
      expect(result[0].type).to.equal(VariableType.SubtypedObject);
      expect(result[0].isContainer).to.be.true;
      expect(result[0].isVirtual).to.be.false;
      expect(result[0].childCount).to.equal(5);
      expect(result[0].refCount).to.equal(3);
    });

    it('parses mixed real and virtual children', () => {
      const writer = new BinaryWriter();
      writer.writeUint32(3); // parent + 2 children

      // Parent node (not a child key)
      writeVariableEntry(writer, {
        flags: VariableFlags.IsNameHere | VariableFlags.IsContainer | VariableFlags.IsRefCounted,
        type: VariableType.SubtypedObject,
        name: 'myNode',
        refCount: 1,
        keyType: VariableType.String,
        childCount: 2,
      });

      // Real child key (e.g. AA field)
      writeVariableEntry(writer, {
        flags: VariableFlags.IsNameHere | VariableFlags.IsValueHere | VariableFlags.IsChildKey,
        type: VariableType.String,
        name: 'realKey',
        stringValue: 'realValue',
      });

      // Virtual child key (node field)
      writeVariableEntry(writer, {
        flags: VariableFlags.IsNameHere | VariableFlags.IsValueHere
          | VariableFlags.IsChildKey | VariableFlags.IsVirtual,
        type: VariableType.String,
        name: 'id',
        stringValue: 'nodeId',
      });

      const result = parseVariables(writer.toBuffer());
      expect(result).to.have.length(3);
      expect(result[0].isVirtual).to.be.false;
      expect(result[0].isChildKey).to.be.false;
      expect(result[1].name).to.equal('realKey');
      expect(result[1].isVirtual).to.be.false;
      expect(result[1].isChildKey).to.be.true;
      expect(result[2].name).to.equal('id');
      expect(result[2].isVirtual).to.be.true;
      expect(result[2].isChildKey).to.be.true;
    });
  });

  describe('getVariables request flags', () => {
    it('builds flags with GetVirtualKeys when includeVirtualKeys=true', () => {
      // Verify the flag combinations are correct
      const getChildKeys = VariableRequestFlags.GetChildKeys;
      const getVirtualKeys = VariableRequestFlags.GetVirtualKeys;
      const virtualPathIncluded = VariableRequestFlags.VirtualPathIncluded;

      expect(getChildKeys).to.equal(0x01);
      expect(getVirtualKeys).to.equal(0x04);
      expect(virtualPathIncluded).to.equal(0x08);

      // Combined flags for expanding a container with virtual keys
      const expandWithVirtual = getChildKeys | getVirtualKeys;
      expect(expandWithVirtual).to.equal(0x05);

      // Combined flags for expanding inside a virtual path
      const expandVirtualPath = getChildKeys | getVirtualKeys | virtualPathIncluded;
      expect(expandVirtualPath).to.equal(0x0D);
    });
  });
});
