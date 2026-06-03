/**
 * Lightweight static type inference for BrightScript documents.
 *
 * BrightScript is dynamically typed, so full inference is not possible without
 * executing the program. This module focuses on the single most common pattern
 * that is both unambiguous and extremely frequent:
 *
 *   varName = CreateObject("roSomething")
 *   varName = CreateObject("roSomething", arg2)
 *
 * It also handles typed function parameters:
 *   sub foo(myArr as roArray)
 *
 * And m. member assignments within a component:
 *   m.transfer = CreateObject("roUrlTransfer")
 *
 * The result is a map of { variableName → componentTypeName } that callers
 * (completion provider, hover provider) can use to look up methods.
 */

/** Maps a local variable name (lowercase) → component name (e.g. "roUrlTransfer") */
export type TypeMap = Map<string, string>;

/**
 * Pattern: `varName = CreateObject("roXxx")` or `varName = CreateObject("roXxx", ...)`
 * Also handles `m.varName = CreateObject(...)` and `varName=CreateObject(...)`.
 */
const CREATE_OBJECT_PATTERN =
  /(?:^[ \t]*|\bm\.)(\w+)\s*=\s*CreateObject\s*\(\s*["']([a-zA-Z]+)["']/gim;

/**
 * Pattern: `sub|function name(param as roXxx, ...)` — typed parameters.
 * Only the first match per parameter is captured.
 */
const TYPED_PARAM_PATTERN =
  /(\w+)\s+as\s+(ro[A-Za-z]+)/gi;

/**
 * Scans the entire document text and returns a TypeMap of all variable names
 * whose types can be statically inferred.
 */
export function inferTypes(text: string): TypeMap {
  const map: TypeMap = new Map();

  // CreateObject assignments
  let m: RegExpExecArray | null;
  CREATE_OBJECT_PATTERN.lastIndex = 0;
  while ((m = CREATE_OBJECT_PATTERN.exec(text)) !== null) {
    const varName = m[1].toLowerCase();
    const typeName = m[2]; // preserve original casing for lookup
    map.set(varName, typeName);
  }

  // Typed function parameters
  TYPED_PARAM_PATTERN.lastIndex = 0;
  while ((m = TYPED_PARAM_PATTERN.exec(text)) !== null) {
    const varName = m[1].toLowerCase();
    const typeName = m[2];
    // Don't overwrite a CreateObject binding with a weaker param hint
    if (!map.has(varName)) {
      map.set(varName, typeName);
    }
  }

  return map;
}

/**
 * Given the source text and a cursor position, returns the variable name
 * immediately before the `.` that triggered member completion, or null.
 *
 * Handles patterns like:
 *   `myArr.`       → "myArr"
 *   `m.transfer.`  → "transfer"   (the last segment)
 */
export function getReceiverName(line: string, charPos: number): string | null {
  // Walk back past any word characters (cursor may be inside a method name)
  let pos = charPos;
  while (pos > 0 && /\w/.test(line[pos - 1])) {
    pos--;
  }

  // The character immediately before the word start must be a dot
  if (pos <= 0 || line[pos - 1] !== '.') return null;

  // Extract the identifier before the dot
  const beforeDot = line.substring(0, pos - 1);
  const identMatch = /(\w+)$/.exec(beforeDot);
  if (!identMatch) return null;

  return identMatch[1];
}

/**
 * Resolves what type a receiver expression has, given the full document TypeMap.
 * For `m.foo.` style chains this returns the type of the last named segment.
 */
export function resolveReceiverType(receiverName: string, typeMap: TypeMap): string | undefined {
  return typeMap.get(receiverName.toLowerCase());
}
