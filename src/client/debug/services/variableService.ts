import { VariableType } from '../protocol/constants';
import type { VariableInfo } from '../protocol/types';

const VAR_REF_BASE = 1000;

export interface VarRefEntry {
  threadIndex: number;
  stackFrameIndex: number;
  path: string[];
  hasVirtualPath: boolean;
}

export interface DapVariable {
  name: string;
  value: string;
  type: string;
  variablesReference: number;
  presentationHint?: { kind: string };
}

export class VariableService {
  private nextVarRef = VAR_REF_BASE;
  private varRefs = new Map<number, VarRefEntry>();

  allocate(threadIndex: number, stackFrameIndex: number, path: string[], hasVirtualPath = false): number {
    const ref = this.nextVarRef++;
    this.varRefs.set(ref, { threadIndex, stackFrameIndex, path, hasVirtualPath });
    return ref;
  }

  get(ref: number): VarRefEntry | undefined {
    return this.varRefs.get(ref);
  }

  reset(): void {
    this.nextVarRef = VAR_REF_BASE;
    this.varRefs.clear();
  }

  toDAP(
    v: VariableInfo,
    displayName: string,
    threadIndex: number,
    stackFrameIndex: number,
    parentPath: string[],
    isProperty: boolean,
    parentHasVirtualPath: boolean,
  ): DapVariable {
    const childPath = [...parentPath, displayName];
    const childHasVirtualPath = parentHasVirtualPath || v.isVirtual;
    const varRef = v.isContainer && v.childCount > 0
      ? this.allocate(threadIndex, stackFrameIndex, childPath, childHasVirtualPath)
      : 0;

    const typeName = variableTypeName(v.type);
    let displayValue: string;

    if (v.isContainer) {
      displayValue = v.value
        ? `${v.value} (${v.childCount} items)`
        : `${typeName} (${v.childCount} items)`;
    } else if (v.value) {
      displayValue = v.type === VariableType.String ? `"${v.value}"` : v.value;
    } else {
      displayValue = typeName;
    }

    return {
      name: displayName,
      value: displayValue,
      type: typeName,
      variablesReference: varRef,
      ...(isProperty ? { presentationHint: { kind: 'property' } } : {}),
    };
  }
}

/** Returns the canonical BrightScript type name for a VariableType enum. */
export function variableTypeName(type: VariableType): string {
  switch (type) {
    case VariableType.AA: return 'roAssociativeArray';
    case VariableType.Array: return 'roArray';
    case VariableType.Boolean: return 'Boolean';
    case VariableType.Double: return 'Double';
    case VariableType.Float: return 'Float';
    case VariableType.Function: return 'Function';
    case VariableType.Integer: return 'Integer';
    case VariableType.Interface: return 'Interface';
    case VariableType.Invalid: return 'Invalid';
    case VariableType.List: return 'roList';
    case VariableType.LongInteger: return 'LongInteger';
    case VariableType.Object: return 'Object';
    case VariableType.String: return 'String';
    case VariableType.Subroutine: return 'Function';
    case VariableType.SubtypedObject: return 'Object';
    case VariableType.Uninitialized: return 'Uninitialized';
    case VariableType.Unknown: return 'Unknown';
    default: return 'Unknown';
  }
}
