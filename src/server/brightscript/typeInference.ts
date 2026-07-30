/**
 * Lightweight static type inference for BrightScript documents.
 *
 * BrightScript is dynamically typed, so full inference is not possible without
 * executing the program. This module focuses on patterns that are both
 * unambiguous and extremely frequent:
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
 * And numeric literal assignments:
 *   x = 255           → Integer
 *   x = &HFF          → Integer
 *   x = 2.01          → Float
 *   x = 1.23456E+30   → Float
 *   x = 2!            → Float
 *   x = 1.23456789D-12→ Double
 *   x = 2.3#          → Double
 *   x = 9876543210&   → LongInteger
 *   x = &hABCDEF1234& → LongInteger
 *
 * The result is a map of { variableName → typeName } that callers
 * (completion provider, hover provider) can use to look up methods or
 * display type information.
 */


/** Maps a local variable name (lowercase) → type name (e.g. "roUrlTransfer" or "Integer") */
export type TypeMap = Map<string, string>;

// Hoisted to module scope so these aren't re-allocated on every completion/hover
// trigger (getReceiverName / getInlineCreateObjectType run on each keystroke).
// All non-global, so they carry no lastIndex state and are safe to share.
const WORD_CHAR_RE = /\w/;
const TRAILING_IDENT_RE = /(\w+)$/;
const INLINE_CREATE_OBJECT_RE = /CreateObject\s*\(\s*"([a-zA-Z]+)"\s*(?:,[^)]*?)?\s*\)\s*$/i;


/**
 * Walks backward from `charPos` past word characters (`\w`) and returns the
 * index of the first word character — the start of the identifier ending at
 * `charPos`. Returns `charPos` unchanged if the preceding character isn't a
 * word character.
 */
export function walkBackToWordStart(line: string, charPos: number): number {
  let pos = charPos;
  while (pos > 0 && WORD_CHAR_RE.test(line[pos - 1])) {
    pos--;
  }
  return pos;
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
  const pos = walkBackToWordStart(line, charPos);

  // The character immediately before the word start must be a dot
  if (pos <= 0 || line[pos - 1] !== '.') return null;

  // Extract the identifier before the dot
  const beforeDot = line.substring(0, pos - 1);
  const identMatch = TRAILING_IDENT_RE.exec(beforeDot);
  if (!identMatch) return null;

  return identMatch[1];
}

/**
 * Detects an inline `CreateObject("roXxx").` pattern and returns the component
 * name directly. Returns undefined if the cursor is not after such a pattern.
 */
export function getInlineCreateObjectType(line: string, charPos: number): string | undefined {
  const pos = walkBackToWordStart(line, charPos);

  // Must have a dot before the word
  if (pos <= 0 || line[pos - 1] !== '.') return undefined;

  // Check if the text before the dot ends with CreateObject("...")
  const beforeDot = line.substring(0, pos - 1);
  const match = INLINE_CREATE_OBJECT_RE.exec(beforeDot);
  return match ? match[1] : undefined;
}

/**
 * Resolves what type a receiver expression has, given the full document TypeMap.
 * For `m.foo.` style chains this returns the type of the last named segment.
 */
export function resolveReceiverType(receiverName: string, typeMap: TypeMap): string | undefined {
  return typeMap.get(receiverName.toLowerCase());
}
