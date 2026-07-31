/**
 * BrightScript component catalog.
 *
 * Each entry models one ro* object that can be instantiated with CreateObject().
 * Components implement one or more named interfaces (ifXxx); each interface
 * exposes a set of methods.
 *
 * Sourced from the official Roku BrightScript reference:
 *   https://developer.roku.com/dev/docs/brightscript
 *
 * LAST VERIFIED AGAINST ROKU DOCS: 2026-06-04
 * (Update this date whenever the catalog is refreshed from the official docs.
 *  See docs/brightscript-components.md for the change-log.)
 */

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface BrightScriptMethod {
  name: string;
  /** Full BrightScript signature, e.g. `Push(a as Dynamic) as Void` */
  signature: string;
  returnType: string;
  description: string;
  /** Firmware version in which the method was added, if known */
  since?: string;
  /** True when Roku has deprecated this method */
  deprecated?: boolean;
  deprecationNote?: string;
}

interface BrightScriptInterface {
  /** Interface name, e.g. `ifArray` */
  name: string;
  description: string;
  /** URL of the official Roku documentation page for this interface */
  docsUrl: string;
  methods: BrightScriptMethod[];
}

interface BrightScriptComponent {
  /** Component name as passed to CreateObject(), e.g. `roArray` */
  name: string;
  description: string;
  /** URL of the official documentation page */
  docsUrl: string;
  /** Interface names implemented by this component */
  interfaces: string[];
  /** Minimum Roku OS version that supports this component */
  since?: string;
  /** Whether Roku has deprecated this component */
  deprecated?: boolean;
  deprecationNote?: string;
}

// ---------------------------------------------------------------------------
// Interface definitions
// ---------------------------------------------------------------------------

export const BRIGHTSCRIPT_INTERFACES: Record<string, BrightScriptInterface> = {

  // ── ifArray ──────────────────────────────────────────────────────────────
  ifArray: {
    name: 'ifArray',
    description: 'Core array operations: push/pop, shift/unshift, count, clear, append.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifarray.md',
    methods: [
      { name: 'Peek', signature: 'Peek() as Dynamic', returnType: 'Dynamic', description: 'Returns the last element without removing it. Returns invalid if array is empty.' },
      { name: 'Pop', signature: 'Pop() as Dynamic', returnType: 'Dynamic', description: 'Removes and returns the last element. Returns invalid if empty.' },
      { name: 'Push', signature: 'Push(a as Dynamic) as Void', returnType: 'Void', description: 'Appends a value to the end of the array.' },
      { name: 'Shift', signature: 'Shift() as Dynamic', returnType: 'Dynamic', description: 'Removes and returns the first element.' },
      { name: 'Unshift', signature: 'Unshift(a as Dynamic) as Void', returnType: 'Void', description: 'Inserts a value at the beginning of the array.' },
      { name: 'Delete', signature: 'Delete(index as Integer) as Boolean', returnType: 'Boolean', description: 'Removes the element at the given index, shifting subsequent elements down. Returns true on success.' },
      { name: 'Count', signature: 'Count() as Integer', returnType: 'Integer', description: 'Returns the number of elements in the array.' },
      { name: 'Clear', signature: 'Clear() as Void', returnType: 'Void', description: 'Removes all elements from the array.' },
      { name: 'Append', signature: 'Append(a as Object) as Void', returnType: 'Void', description: 'Appends all elements from another array to this array.' },
    ],
  },

  // ── ifArrayGet ───────────────────────────────────────────────────────────
  ifArrayGet: {
    name: 'ifArrayGet',
    description: 'Indexed read access for arrays.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifarrayget.md',
    methods: [
      { name: 'GetEntry', signature: 'GetEntry(index as Integer) as Dynamic', returnType: 'Dynamic', description: 'Returns the element at index. Returns invalid if out of bounds.' },
    ],
  },

  // ── ifArraySet ───────────────────────────────────────────────────────────
  ifArraySet: {
    name: 'ifArraySet',
    description: 'Indexed write access for arrays.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifarrayset.md',
    methods: [
      { name: 'SetEntry', signature: 'SetEntry(index as Integer, value as Dynamic) as Void', returnType: 'Void', description: 'Sets the element at index to value. Extends the array if index >= Count().' },
    ],
  },

  // ── ifArrayJoin ──────────────────────────────────────────────────────────
  ifArrayJoin: {
    name: 'ifArrayJoin',
    description: 'Joins array elements into a single string.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifarrayjoin.md',
    methods: [
      { name: 'Join', signature: 'Join(separator as String) as String', returnType: 'String', description: 'Returns a string of all elements joined by separator.' },
    ],
  },

  // ── ifArraySort ──────────────────────────────────────────────────────────
  ifArraySort: {
    name: 'ifArraySort',
    description: 'In-place array sorting and reversal.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifarraysort.md',
    methods: [
      { name: 'Sort', signature: 'Sort(flags = "" as String) as Void', returnType: 'Void', description: 'Sorts the array in place. flags: "r" = reverse, "i" = case-insensitive.' },
      { name: 'SortBy', signature: 'SortBy(fieldName as String, flags = "" as String) as Void', returnType: 'Void', description: 'Sorts an array of AssociativeArrays by the given field name.' },
      { name: 'Reverse', signature: 'Reverse() as Void', returnType: 'Void', description: 'Reverses the order of elements in the array.' },
    ],
  },

  // ── ifArraySizeInfo ──────────────────────────────────────────────────────
  ifArraySizeInfo: {
    name: 'ifArraySizeInfo',
    description: 'Array capacity and resize information.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifarraysizeinfo.md',
    methods: [
      { name: 'Capacity', signature: 'Capacity() as Integer', returnType: 'Integer', description: 'Returns the currently allocated capacity of the array.' },
      { name: 'IsResizable', signature: 'IsResizable() as Boolean', returnType: 'Boolean', description: 'Returns true if the array can be resized dynamically.' },
      { name: 'Reserve', signature: 'Reserve(size as Integer) as Void', returnType: 'Void', description: 'Reserves capacity for at least the given number of entries.' },
      { name: 'ShrinkToFit', signature: 'ShrinkToFit() as Void', returnType: 'Void', description: 'Reduces capacity to match the current entry count.' },
    ],
  },

  // ── ifArraySlice ─────────────────────────────────────────────────────────
  ifArraySlice: {
    name: 'ifArraySlice',
    description: 'Returns a sub-array (shallow copy) of a range.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifarrayslice.md',
    methods: [
      { name: 'Slice', signature: 'Slice(startIndex as Integer, endIndex = -1 as Integer) as Object', returnType: 'roArray', description: 'Returns a new roArray containing elements from startIndex up to (not including) endIndex. Negative endIndex means to the end.', since: '10.0' },
    ],
  },

  // ── ifEnum ───────────────────────────────────────────────────────────────
  ifEnum: {
    name: 'ifEnum',
    description: 'Iterator interface used in for-each loops.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifenum.md',
    methods: [
      { name: 'Reset', signature: 'Reset() as Void', returnType: 'Void', description: 'Resets the iterator to the beginning.' },
      { name: 'Next', signature: 'Next() as Dynamic', returnType: 'Dynamic', description: 'Returns the next item and advances the iterator.' },
      { name: 'IsNext', signature: 'IsNext() as Boolean', returnType: 'Boolean', description: 'Returns true if there are more items to iterate.' },
      { name: 'IsEmpty', signature: 'IsEmpty() as Boolean', returnType: 'Boolean', description: 'Returns true when the enumeration contains no elements.' },
    ],
  },

  // ── ifAssociativeArray ───────────────────────────────────────────────────
  ifAssociativeArray: {
    name: 'ifAssociativeArray',
    description: 'Key-value dictionary operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifassociativearray.md',
    methods: [
      { name: 'AddReplace', signature: 'AddReplace(key as String, value as Dynamic) as Void', returnType: 'Void', description: 'Sets key to value, replacing any existing entry.' },
      { name: 'Clear', signature: 'Clear() as Void', returnType: 'Void', description: 'Removes all key-value pairs.' },
      { name: 'Delete', signature: 'Delete(key as String) as Boolean', returnType: 'Boolean', description: 'Removes the entry for key. Returns true if it existed.' },
      { name: 'DoesExist', signature: 'DoesExist(key as String) as Boolean', returnType: 'Boolean', description: 'Returns true if key exists in the array (case-insensitive by default).' },
      { name: 'Items', signature: 'Items() as Object', returnType: 'roArray', description: 'Returns an roArray of roAssociativeArrays, each with "key" and "value" fields.' },
      { name: 'Keys', signature: 'Keys() as Object', returnType: 'roArray', description: 'Returns an roArray of all keys as strings.' },
      { name: 'Lookup', signature: 'Lookup(key as String) as Dynamic', returnType: 'Dynamic', description: 'Returns the value for key, or invalid if not found. Default case-insensitive.' },
      { name: 'LookupCI', signature: 'LookupCI(key as String) as Dynamic', returnType: 'Dynamic', description: 'Case-insensitive key lookup. Returns invalid if not found.' },
      { name: 'Count', signature: 'Count() as Integer', returnType: 'Integer', description: 'Returns the number of key-value pairs.' },
      { name: 'Append', signature: 'Append(aa as Object) as Void', returnType: 'Void', description: 'Copies all key-value pairs from aa into this array, replacing existing keys.' },
      { name: 'SetModeCaseSensitive', signature: 'SetModeCaseSensitive() as Void', returnType: 'Void', description: 'Switches key lookup to case-sensitive mode.' },
    ],
  },

  // ── ifString ─────────────────────────────────────────────────────────────
  ifString: {
    name: 'ifString',
    description: 'Basic string get/set operations on roString.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifstring.md',
    methods: [
      { name: 'SetString', signature: 'SetString(s as String) as Void', returnType: 'Void', description: 'Sets the internal string value.' },
      { name: 'GetString', signature: 'GetString() as String', returnType: 'String', description: 'Returns the internal string value.' },
      { name: 'IsEmpty', signature: 'IsEmpty() as Boolean', returnType: 'Boolean', description: 'Returns true when the string has zero length.' },
    ],
  },

  // ── ifStringOps ──────────────────────────────────────────────────────────
  ifStringOps: {
    name: 'ifStringOps',
    description: 'Rich string manipulation operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifstringops.md',
    methods: [
      { name: 'Len', signature: 'Len() as Integer', returnType: 'Integer', description: 'Returns the number of characters in the string.' },
      { name: 'Left', signature: 'Left(n as Integer) as String', returnType: 'String', description: 'Returns the leftmost n characters.' },
      { name: 'Right', signature: 'Right(n as Integer) as String', returnType: 'String', description: 'Returns the rightmost n characters.' },
      { name: 'Mid', signature: 'Mid(startIndex as Integer, numChars = -1 as Integer) as String', returnType: 'String', description: 'Returns a substring starting at startIndex (1-based). numChars=-1 means to end.' },
      { name: 'Instr', signature: 'Instr(startIndex as Integer, substring as String) as Integer', returnType: 'Integer', description: 'Returns the 1-based position of substring, starting at startIndex. Returns 0 if not found.' },
      { name: 'Replace', signature: 'Replace(from as String, to as String) as String', returnType: 'String', description: 'Returns a new string with all occurrences of from replaced by to.' },
      { name: 'Trim', signature: 'Trim() as String', returnType: 'String', description: 'Returns the string with leading and trailing whitespace removed.' },
      { name: 'Split', signature: 'Split(delim as String) as Object', returnType: 'roArray', description: 'Splits the string at each occurrence of delim and returns an roArray of substrings.' },
      { name: 'Tokenize', signature: 'Tokenize(delim as String) as Object', returnType: 'roList', description: 'Splits the string using delim as a set of separator characters, returning an roList.' },
      { name: 'StartsWith', signature: 'StartsWith(substring as String, startIndex = 0 as Integer) as Boolean', returnType: 'Boolean', description: 'Returns true if the string starts with substring at the given offset.' },
      { name: 'EndsWith', signature: 'EndsWith(substring as String) as Boolean', returnType: 'Boolean', description: 'Returns true if the string ends with substring.' },
      { name: 'EncodeUri', signature: 'EncodeUri() as String', returnType: 'String', description: 'Returns the string with URI-unsafe characters percent-encoded.' },
      { name: 'DecodeUri', signature: 'DecodeUri() as String', returnType: 'String', description: 'Returns the string with percent-encoded URI characters decoded.' },
      { name: 'EncodeUriComponent', signature: 'EncodeUriComponent() as String', returnType: 'String', description: 'Encodes the string as a URI component.' },
      { name: 'DecodeUriComponent', signature: 'DecodeUriComponent() as String', returnType: 'String', description: 'Decodes a URI component string.' },
      { name: 'SetString', signature: 'SetString(str as String) as Void', returnType: 'Void', description: 'Sets the string value.' },
      { name: 'AppendString', signature: 'AppendString(str as String, length as Integer) as Void', returnType: 'Void', description: 'Appends the first length characters of str.' },
      { name: 'ToInt', signature: 'ToInt() as Integer', returnType: 'Integer', description: 'Converts the string to an Integer.' },
      { name: 'ToFloat', signature: 'ToFloat() as Float', returnType: 'Float', description: 'Converts the string to a Float.' },
      { name: 'GetEntityEncode', signature: 'GetEntityEncode() as String', returnType: 'String', description: 'Returns the string with HTML entity encoding.' },
      { name: 'Escape', signature: 'Escape() as String', returnType: 'String', description: 'URL-encodes the string.' },
      { name: 'Unescape', signature: 'Unescape() as String', returnType: 'String', description: 'URL-decodes the string.' },
      { name: 'Format', signature: 'Format(...args) as String', returnType: 'String', description: 'Returns a formatted string using % placeholders.' },
      { name: 'Arg', signature: 'Arg(value as Dynamic) as String', returnType: 'String', description: 'Returns the string with the next positional placeholder replaced by value.' },
    ],
  },

  // ── ifToStr ──────────────────────────────────────────────────────────────
  ifToStr: {
    name: 'ifToStr',
    description: 'Common interface for converting a value to its string representation.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iftostr.md',
    methods: [
      { name: 'ToStr', signature: 'ToStr() as String', returnType: 'String', description: 'Returns the string representation of the value.' },
    ],
  },

  // ── ifInt ────────────────────────────────────────────────────────────────
  ifInt: {
    name: 'ifInt',
    description: 'Get/set operations on roInt.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifint.md',
    methods: [
      { name: 'GetInt', signature: 'GetInt() as Integer', returnType: 'Integer', description: 'Returns the integer value.' },
      { name: 'SetInt', signature: 'SetInt(value as Integer) as Void', returnType: 'Void', description: 'Sets the integer value.' },
    ],
  },

  // ── ifFloat ──────────────────────────────────────────────────────────────
  ifFloat: {
    name: 'ifFloat',
    description: 'Get/set operations on roFloat.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iffloat.md',
    methods: [
      { name: 'GetFloat', signature: 'GetFloat() as Float', returnType: 'Float', description: 'Returns the float value.' },
      { name: 'SetFloat', signature: 'SetFloat(value as Float) as Void', returnType: 'Void', description: 'Sets the float value.' },
    ],
  },

  // ── ifDouble ─────────────────────────────────────────────────────────────
  ifDouble: {
    name: 'ifDouble',
    description: 'Get/set operations on roDouble.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifdouble.md',
    methods: [
      { name: 'GetDouble', signature: 'GetDouble() as Double', returnType: 'Double', description: 'Returns the double value.' },
      { name: 'SetDouble', signature: 'SetDouble(value as Double) as Void', returnType: 'Void', description: 'Sets the double value.' },
    ],
  },

  // ── ifLongInt ────────────────────────────────────────────────────────────
  ifLongInt: {
    name: 'ifLongInt',
    description: 'Get/set operations on roLongInteger.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iflongint.md',
    methods: [
      { name: 'GetLongInt', signature: 'GetLongInt() as LongInteger', returnType: 'LongInteger', description: 'Returns the long integer value.' },
      { name: 'SetLongInt', signature: 'SetLongInt(value as LongInteger) as Void', returnType: 'Void', description: 'Sets the long integer value.' },
    ],
  },

  // ── ifBoolean ────────────────────────────────────────────────────────────
  ifBoolean: {
    name: 'ifBoolean',
    description: 'Get/set operations on roBoolean.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifboolean.md',
    methods: [
      { name: 'GetBoolean', signature: 'GetBoolean() as Boolean', returnType: 'Boolean', description: 'Returns the boolean value.' },
      { name: 'SetBoolean', signature: 'SetBoolean(value as Boolean) as Void', returnType: 'Void', description: 'Sets the boolean value.' },
    ],
  },

  // ── ifList ───────────────────────────────────────────────────────────────
  ifList: {
    name: 'ifList',
    description: 'Doubly-linked list operations for roList.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iflist.md',
    methods: [
      { name: 'AddTail', signature: 'AddTail(obj as Dynamic) as Void', returnType: 'Void', description: 'Appends obj at the end of the list.' },
      { name: 'AddHead', signature: 'AddHead(obj as Dynamic) as Void', returnType: 'Void', description: 'Inserts obj at the front of the list.' },
      { name: 'RemoveTail', signature: 'RemoveTail() as Dynamic', returnType: 'Dynamic', description: 'Removes and returns the last element.' },
      { name: 'RemoveHead', signature: 'RemoveHead() as Dynamic', returnType: 'Dynamic', description: 'Removes and returns the first element.' },
      { name: 'GetTail', signature: 'GetTail() as Dynamic', returnType: 'Dynamic', description: 'Returns the last element without removing it.' },
      { name: 'GetHead', signature: 'GetHead() as Dynamic', returnType: 'Dynamic', description: 'Returns the first element without removing it.' },
      { name: 'RemoveIndex', signature: 'RemoveIndex(index as Integer) as Boolean', returnType: 'Boolean', description: 'Removes the element at the given zero-based index.' },
      { name: 'Count', signature: 'Count() as Integer', returnType: 'Integer', description: 'Returns the number of elements.' },
      { name: 'Clear', signature: 'Clear() as Void', returnType: 'Void', description: 'Removes all elements.' },
      { name: 'ResetIndex', signature: 'ResetIndex() as Boolean', returnType: 'Boolean', description: 'Resets the list iterator to the head.' },
      { name: 'GetIndex', signature: 'GetIndex() as Dynamic', returnType: 'Dynamic', description: 'Returns the current element and advances the internal iterator.' },
    ],
  },

  // ── ifByteArray ──────────────────────────────────────────────────────────
  ifByteArray: {
    name: 'ifByteArray',
    description: 'Binary data buffer operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifbytearray.md',
    methods: [
      { name: 'WriteFile', signature: 'WriteFile(filePath as String, startIndex = 0 as Integer, length = -1 as Integer) as Boolean', returnType: 'Boolean', description: 'Writes the byte array to filePath. Returns true on success.' },
      { name: 'ReadFile', signature: 'ReadFile(filePath as String, startIndex = 0 as Integer, length = -1 as Integer) as Boolean', returnType: 'Boolean', description: 'Reads a file into the byte array. Returns true on success.' },
      { name: 'AppendFile', signature: 'AppendFile(filePath as String, startIndex = 0 as Integer, length = -1 as Integer) as Boolean', returnType: 'Boolean', description: 'Appends the byte array contents to filePath.' },
      { name: 'SetResize', signature: 'SetResize(minSize as Integer, isResizable as Boolean) as Void', returnType: 'Void', description: 'Sets minimum allocation size and whether the array auto-resizes.' },
      { name: 'FromHexString', signature: 'FromHexString(hex as String) as Boolean', returnType: 'Boolean', description: 'Loads byte array from a hex-encoded string.' },
      { name: 'ToHexString', signature: 'ToHexString() as String', returnType: 'String', description: 'Returns the byte array as a hex-encoded string.' },
      { name: 'FromBase64String', signature: 'FromBase64String(base64 as String) as Boolean', returnType: 'Boolean', description: 'Loads byte array from a Base64-encoded string.' },
      { name: 'ToBase64String', signature: 'ToBase64String() as String', returnType: 'String', description: 'Returns the byte array encoded as Base64.' },
      { name: 'FromAsciiString', signature: 'FromAsciiString(s as String) as Void', returnType: 'Void', description: 'Loads byte array from an ASCII string.' },
      { name: 'ToAsciiString', signature: 'ToAsciiString() as String', returnType: 'String', description: 'Returns the byte array as an ASCII string.' },
      { name: 'GetSignedByte', signature: 'GetSignedByte(index as Integer) as Integer', returnType: 'Integer', description: 'Returns the byte at index as a signed integer (-128 to 127).' },
      { name: 'GetSignedLong', signature: 'GetSignedLong(index as Integer) as Integer', returnType: 'Integer', description: 'Returns 4 bytes starting at index as a signed 32-bit integer.' },
      { name: 'IsLittleEndianCPU', signature: 'IsLittleEndianCPU() as Boolean', returnType: 'Boolean', description: 'Returns true if the device CPU is little-endian.' },
      { name: 'GetCRC32', signature: 'GetCRC32(startIndex = 0 as Integer, length = -1 as Integer) as Integer', returnType: 'Integer', description: 'Computes and returns the CRC-32 checksum of the byte array.' },
      { name: 'Slice', signature: 'Slice(start as Integer, length as Integer) as Object', returnType: 'Object', description: 'Returns a new roByteArray containing a portion of this array.' },
    ],
  },

  // ── ifXMLElement ─────────────────────────────────────────────────────────
  ifXMLElement: {
    name: 'ifXMLElement',
    description: 'XML element read/write operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifxmlelement.md',
    methods: [
      { name: 'Parse', signature: 'Parse(xml as String) as Boolean', returnType: 'Boolean', description: 'Parses an XML string into this element. Returns true on success.' },
      { name: 'GetBody', signature: 'GetBody() as Dynamic', returnType: 'Dynamic', description: 'Returns child elements as roXMLList, or the text body as a String, or invalid.' },
      { name: 'GetAttributes', signature: 'GetAttributes() as Object', returnType: 'roAssociativeArray', description: 'Returns an roAssociativeArray of the element\'s attributes.' },
      { name: 'GetName', signature: 'GetName() as String', returnType: 'String', description: 'Returns the element tag name.' },
      { name: 'GetText', signature: 'GetText() as String', returnType: 'String', description: 'Returns the text content of the element.' },
      { name: 'GetChildElements', signature: 'GetChildElements() as Object', returnType: 'roXMLList', description: 'Returns direct child elements as an roXMLList.' },
      { name: 'Clear', signature: 'Clear() as Void', returnType: 'Void', description: 'Removes all children, text, and attributes.' },
      { name: 'GenXML', signature: 'GenXML(includeDeclaration as Boolean) as String', returnType: 'String', description: 'Serializes the element and its children to an XML string.' },
      { name: 'GenXMLHdr', signature: 'GenXMLHdr(includeDeclaration as Boolean) as String', returnType: 'String', description: 'Serializes the element tag (without children) to a string.' },
      { name: 'SetBody', signature: 'SetBody(value as Object) as Void', returnType: 'Void', description: 'Sets the text body or child list of the element.' },
      { name: 'SetName', signature: 'SetName(name as String) as Void', returnType: 'Void', description: 'Sets the element tag name.' },
      { name: 'AddAttribute', signature: 'AddAttribute(key as String, value as String) as Void', returnType: 'Void', description: 'Adds or replaces an attribute on the element.' },
      { name: 'IsName', signature: 'IsName(name as String) as Boolean', returnType: 'Boolean', description: 'Returns true if the element tag name matches name (case-insensitive).' },
      { name: 'HasAttribute', signature: 'HasAttribute(name as String) as Boolean', returnType: 'Boolean', description: 'Returns true if the element has the given attribute.' },
      { name: 'GetChildNodes', signature: 'GetChildNodes() as Object', returnType: 'Object', description: 'Returns all child nodes including text nodes.' },
      { name: 'GetNamedElements', signature: 'GetNamedElements(name as String) as Object', returnType: 'Object', description: 'Returns child elements matching the given name.' },
      { name: 'GetNamedElementsCi', signature: 'GetNamedElementsCi(name as String) as Object', returnType: 'Object', description: 'Case-insensitive version of GetNamedElements.' },
      { name: 'AddBodyElement', signature: 'AddBodyElement() as Object', returnType: 'Object', description: 'Adds a new unnamed child element to the body.' },
      { name: 'AddElement', signature: 'AddElement(name as String) as Object', returnType: 'Object', description: 'Adds a new named child element.' },
      { name: 'AddElementWithBody', signature: 'AddElementWithBody(name as String, body as String) as Object', returnType: 'Object', description: 'Adds a new named child element with body text.' },
      { name: 'AddText', signature: 'AddText(text as String) as Void', returnType: 'Void', description: 'Adds a text node to the element body.' },
    ],
  },

  // ── ifXMLList ─────────────────────────────────────────────────────────────
  ifXMLList: {
    name: 'ifXMLList',
    description: 'Operations on a list of XML elements.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifxmllist.md',
    methods: [
      { name: 'GetAttributes', signature: 'GetAttributes() as Object', returnType: 'roAssociativeArray', description: 'Returns attributes of the first element.' },
      { name: 'GetChildElements', signature: 'GetChildElements() as Object', returnType: 'roXMLList', description: 'Returns child elements of the first element.' },
      { name: 'GetText', signature: 'GetText() as String', returnType: 'String', description: 'Returns text content of the first element.' },
      { name: 'Simplify', signature: 'Simplify() as Dynamic', returnType: 'Dynamic', description: 'If the list has one element returns it, otherwise returns the list itself.' },
      { name: 'GetNamedElements', signature: 'GetNamedElements(name as String) as Object', returnType: 'Object', description: 'Returns an roXMLList of child elements matching the given name (case-sensitive).' },
      { name: 'GetNamedElementsCi', signature: 'GetNamedElementsCi(name as String) as Object', returnType: 'Object', description: 'Returns an roXMLList of child elements matching the given name, case-insensitively.' },
    ],
  },

  // ── ifDateTime ───────────────────────────────────────────────────────────
  ifDateTime: {
    name: 'ifDateTime',
    description: 'Date/time parsing and formatting.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifdatetime.md',
    methods: [
      { name: 'Mark', signature: 'Mark() as Void', returnType: 'Void', description: 'Sets the date/time to the current UTC time.' },
      { name: 'GetDayOfWeek', signature: 'GetDayOfWeek() as Integer', returnType: 'Integer', description: 'Returns day of week (0=Sunday … 6=Saturday).' },
      { name: 'GetDayOfMonth', signature: 'GetDayOfMonth() as Integer', returnType: 'Integer', description: 'Returns day of month (1–31).' },
      { name: 'GetHours', signature: 'GetHours() as Integer', returnType: 'Integer', description: 'Returns hours component (0–23, UTC).' },
      { name: 'GetMinutes', signature: 'GetMinutes() as Integer', returnType: 'Integer', description: 'Returns minutes component (0–59).' },
      { name: 'GetSeconds', signature: 'GetSeconds() as Integer', returnType: 'Integer', description: 'Returns seconds component (0–59).' },
      { name: 'GetMilliseconds', signature: 'GetMilliseconds() as Integer', returnType: 'Integer', description: 'Returns milliseconds component (0–999).' },
      { name: 'GetMonth', signature: 'GetMonth() as Integer', returnType: 'Integer', description: 'Returns month (1–12).' },
      { name: 'GetYear', signature: 'GetYear() as Integer', returnType: 'Integer', description: 'Returns the four-digit year.' },
      { name: 'GetTimeZoneOffset', signature: 'GetTimeZoneOffset() as Integer', returnType: 'Integer', description: 'Returns local timezone offset from UTC in minutes.' },
      { name: 'AsDateString', signature: 'AsDateString(format as String) as String', returnType: 'String', description: 'Formats the date/time per format string. Formats: "short-date", "long-date", "short-date-time", "long-date-time".' },
      { name: 'AsSeconds', signature: 'AsSeconds() as Integer', returnType: 'Integer', description: 'Returns Unix timestamp (seconds since 1970-01-01 UTC).' },
      { name: 'FromSeconds', signature: 'FromSeconds(seconds as Integer) as Void', returnType: 'Void', description: 'Sets the date/time from a Unix timestamp.' },
      { name: 'ToLocalTime', signature: 'ToLocalTime() as Void', returnType: 'Void', description: 'Converts the date/time to local time.' },
      { name: 'ToISOString', signature: 'ToISOString(format as String) as String', returnType: 'String', description: 'Returns the date/time as an ISO 8601 string (e.g. "2024-01-15T10:30:00Z"). Also callable with no argument — `ToISOString()` — for the default format.' },
      { name: 'FromISO8601String', signature: 'FromISO8601String(dateString as String) as Void', returnType: 'Void', description: 'Sets the date/time from an ISO 8601 string.' },
      { name: 'AsSecondsLong', signature: 'AsSecondsLong() as LongInteger', returnType: 'LongInteger', description: 'Returns seconds from the Unix epoch as a LongInteger, for dates beyond the 32-bit range of AsSeconds(). Roku documents the return as "Object".' },
      { name: 'FromSecondsLong', signature: 'FromSecondsLong(numSeconds as LongInteger) as Void', returnType: 'Void', description: 'Sets the date/time from seconds since the Unix epoch, as a LongInteger.' },
      { name: 'asDateStringLoc', signature: 'asDateStringLoc(format as String) as String', returnType: 'String', description: 'Returns the date in a localized format for the device locale. Roku documents this name with a lowercase first letter.' },
      { name: 'asTimeStringLoc', signature: 'asTimeStringLoc(format as String) as String', returnType: 'String', description: 'Returns the time in a localized format for the device locale. Roku documents this name with a lowercase first letter.' },
      { name: 'AsDateStringNoParam', signature: 'AsDateStringNoParam() as String', returnType: 'String', description: 'Returns the date/time in long-date format.' },
      { name: 'GetWeekday', signature: 'GetWeekday() as String', returnType: 'String', description: 'Returns the canonical English day of week name.' },
      { name: 'GetLastDayOfMonth', signature: 'GetLastDayOfMonth() as Integer', returnType: 'Integer', description: 'Returns the last day of the month (28-31).' },
      { name: 'AsMillisecondsLong', signature: 'AsMillisecondsLong() as LongInteger', returnType: 'LongInteger', description: 'Returns milliseconds from the Unix epoch as a LongInteger. Roku documents the return as "Long".' },
    ],
  },

  // ── ifTimespan ───────────────────────────────────────────────────────────
  ifTimespan: {
    name: 'ifTimespan',
    description: 'High-resolution elapsed time measurement.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iftimespan.md',
    methods: [
      { name: 'Mark', signature: 'Mark() as Void', returnType: 'Void', description: 'Resets the timer to zero / marks the start time.' },
      { name: 'TotalMilliseconds', signature: 'TotalMilliseconds() as Integer', returnType: 'Integer', description: 'Returns total elapsed milliseconds since Mark().' },
      { name: 'TotalSeconds', signature: 'TotalSeconds() as Integer', returnType: 'Integer', description: 'Returns total elapsed seconds since Mark().' },
      { name: 'TotalMicroseconds', signature: 'TotalMicroseconds() as Integer', returnType: 'Integer', description: 'Returns microseconds elapsed since the last Mark().' },
      { name: 'GetSecondsToISO8601Date', signature: 'GetSecondsToISO8601Date(date as String) as Integer', returnType: 'Integer', description: 'Returns seconds from now until the given ISO 8601 date.' },
    ],
  },

  // ── ifUrlTransfer ────────────────────────────────────────────────────────
  ifUrlTransfer: {
    name: 'ifUrlTransfer',
    description: 'HTTP/HTTPS request operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifurltransfer.md',
    methods: [
      { name: 'SetUrl', signature: 'SetUrl(url as String) as Void', returnType: 'Void', description: 'Sets the request URL.' },
      { name: 'GetUrl', signature: 'GetUrl() as String', returnType: 'String', description: 'Returns the current URL.' },
      { name: 'SetRequest', signature: 'SetRequest(method as String) as Void', returnType: 'Void', description: 'Sets the HTTP method ("GET", "POST", "PUT", "DELETE", etc.).' },
      { name: 'GetRequest', signature: 'GetRequest() as String', returnType: 'String', description: 'Returns the current HTTP method.' },
      { name: 'GetToString', signature: 'GetToString() as String', returnType: 'String', description: 'Performs a synchronous GET and returns the response body as a string.' },
      { name: 'GetToFile', signature: 'GetToFile(filePath as String) as Integer', returnType: 'Integer', description: 'Performs a synchronous GET, saves body to filePath. Returns HTTP status code.' },
      { name: 'AsyncGetToString', signature: 'AsyncGetToString() as Boolean', returnType: 'Boolean', description: 'Starts an asynchronous GET. Response arrives as roUrlEvent on the message port.' },
      { name: 'AsyncGetToFile', signature: 'AsyncGetToFile(filePath as String) as Boolean', returnType: 'Boolean', description: 'Starts an asynchronous GET, saving to file.' },
      { name: 'PostFromString', signature: 'PostFromString(request as String) as Integer', returnType: 'Integer', description: 'Synchronous POST with string body. Returns HTTP status code.' },
      { name: 'PostFromFile', signature: 'PostFromFile(filePath as String) as Integer', returnType: 'Integer', description: 'Synchronous POST with file body. Returns HTTP status code.' },
      { name: 'AsyncPostFromString', signature: 'AsyncPostFromString(request as String) as Boolean', returnType: 'Boolean', description: 'Asynchronous POST with string body.' },
      { name: 'AsyncPostFromFile', signature: 'AsyncPostFromFile(filePath as String) as Boolean', returnType: 'Boolean', description: 'Asynchronous POST with file body.' },
      { name: 'AsyncCancel', signature: 'AsyncCancel() as Void', returnType: 'Void', description: 'Cancels any in-progress async request.' },
      { name: 'Head', signature: 'Head() as Object', returnType: 'roUrlEvent', description: 'Performs a synchronous HEAD request.' },
      { name: 'AsyncHead', signature: 'AsyncHead() as Boolean', returnType: 'Boolean', description: 'Performs an asynchronous HEAD request.' },
      { name: 'GetFailureReason', signature: 'GetFailureReason() as String', returnType: 'String', description: 'Returns a human-readable description of the last failure.' },
      { name: 'EnablePeerVerification', signature: 'EnablePeerVerification(enable as Boolean) as Void', returnType: 'Void', description: 'Enables/disables SSL peer certificate verification.' },
      { name: 'EnableHostVerification', signature: 'EnableHostVerification(enable as Boolean) as Void', returnType: 'Void', description: 'Enables/disables SSL host name verification.' },
      { name: 'EnableFreshConnection', signature: 'EnableFreshConnection(enable as Boolean) as Void', returnType: 'Void', description: 'When true, always creates a new TCP connection instead of reusing keep-alive.' },
      { name: 'SetMinimumTransferRate', signature: 'SetMinimumTransferRate(bytesPerSecond as Integer, periodSeconds as Integer) as Void', returnType: 'Void', description: 'Cancels the request if the transfer rate drops below bytesPerSecond for periodSeconds.' },
      { name: 'GetIdentity', signature: 'GetIdentity() as Integer', returnType: 'Integer', description: 'Returns a unique identifier for this transfer object.' },
      { name: 'AsyncPostFromFileToFile', signature: 'AsyncPostFromFileToFile(fromFile as String, toFile as String) as Boolean', returnType: 'Boolean', description: 'Starts async POST from a file, writes response to a file.' },
      { name: 'RetainBodyOnError', signature: 'RetainBodyOnError(retain as Boolean) as Boolean', returnType: 'Boolean', description: 'When true, retains response body even on HTTP error codes.' },
      { name: 'SetUserAndPassword', signature: 'SetUserAndPassword(user as String, password as String) as Boolean', returnType: 'Boolean', description: 'Sets HTTP basic auth credentials.' },
      { name: 'EnableEncodings', signature: 'EnableEncodings(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables gzip/deflate encoding for requests.' },
      { name: 'Escape', signature: 'Escape(text as String) as String', returnType: 'String', description: 'URL-encodes a string.' },
      { name: 'Unescape', signature: 'Unescape(text as String) as String', returnType: 'String', description: 'URL-decodes a string.' },
      { name: 'UrlEncode', signature: 'UrlEncode(text as String) as String', returnType: 'String', description: 'URL-encodes a string.', deprecated: true, deprecationNote: 'Use Escape() instead.' },
      { name: 'EnableResume', signature: 'EnableResume(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables automatic resume of interrupted downloads.' },
      { name: 'SetHttpVersion', signature: 'SetHttpVersion(version as String) as Void', returnType: 'Void', description: 'Sets the HTTP version (http1.1 or http2).' },
      { name: 'GetUserAgent', signature: 'GetUserAgent() as String', returnType: 'String', description: 'Returns the current User-Agent string.' },
    ],
  },

  // ifUrlEvent is synthetic, like ifSGNode: Roku documents these methods on the
  // roUrlEvent component page directly, with no separate ifUrlEvent interface
  // page. This is the object an async ifUrlTransfer request (AsyncGetToString,
  // AsyncPostFromString, ...) delivers via the message port on completion —
  // GetResponseCode/GetResponseHeaders/GetResponseHeadersArray live HERE, not
  // on ifUrlTransfer itself, despite looking like they belong on the request.
  ifUrlEvent: {
    name: 'ifUrlEvent',
    description: 'Response delivered via message port when an ifUrlTransfer async request completes.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rourlevent.md',
    methods: [
      { name: 'GetInt', signature: 'GetInt() as Integer', returnType: 'Integer', description: 'Returns the HTTP response code, or a negative value on a transport-level failure.' },
      { name: 'GetResponseCode', signature: 'GetResponseCode() as Integer', returnType: 'Integer', description: 'Returns the HTTP response status code.' },
      { name: 'GetFailureReason', signature: 'GetFailureReason() as String', returnType: 'String', description: 'Returns a human-readable description of the failure, if any.' },
      { name: 'GetString', signature: 'GetString() as String', returnType: 'String', description: 'Returns the response body as a string.' },
      { name: 'GetSourceIdentity', signature: 'GetSourceIdentity() as Integer', returnType: 'Integer', description: "Returns the source roUrlTransfer's GetIdentity() value, so one message port can be shared across several requests." },
      { name: 'GetResponseHeaders', signature: 'GetResponseHeaders() as Object', returnType: 'Object', description: 'Returns response headers as an associative array (last value wins for duplicate header names).' },
      { name: 'GetTargetIpAddress', signature: 'GetTargetIpAddress() as String', returnType: 'String', description: 'Returns the IP address actually connected to for this request.' },
      { name: 'GetResponseHeadersArray', signature: 'GetResponseHeadersArray() as Object', returnType: 'Object', description: 'Returns response headers as an roArray of associative arrays, preserving duplicate header names.' },
    ],
  },

  // ── ifSetMessagePort / ifGetMessagePort ──────────────────────────────────
  ifSetMessagePort: {
    name: 'ifSetMessagePort',
    description: 'Associates an roMessagePort with this object for async event delivery.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsetmessageport.md',
    methods: [
      { name: 'SetMessagePort', signature: 'SetMessagePort(port as Object) as Void', returnType: 'Void', description: 'Sets the roMessagePort that will receive events from this object.' },
    ],
  },

  ifGetMessagePort: {
    name: 'ifGetMessagePort',
    description: 'Retrieves the associated roMessagePort.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifgetmessageport.md',
    methods: [
      { name: 'GetMessagePort', signature: 'GetMessagePort() as Object', returnType: 'roMessagePort', description: 'Returns the roMessagePort currently associated with this object.' },
    ],
  },

  // ── ifMessagePort ────────────────────────────────────────────────────────
  ifMessagePort: {
    name: 'ifMessagePort',
    description: 'Receives asynchronous events from associated ro* objects.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifmessageport.md',
    methods: [
      { name: 'WaitMessage', signature: 'WaitMessage(timeoutMs as Integer) as Object', returnType: 'Dynamic', description: 'Blocks until a message arrives or timeoutMs elapses. Returns the message or invalid.' },
      { name: 'GetMessage', signature: 'GetMessage() as Object', returnType: 'Dynamic', description: 'Returns the next pending message without blocking, or invalid.' },
      { name: 'PeekMessage', signature: 'PeekMessage() as Object', returnType: 'Dynamic', description: 'Returns the next pending message without removing it from the queue, or invalid.' },
    ],
  },

  // ── ifRenderThreadQueue ──────────────────────────────────────────────────
  ifRenderThreadQueue: {
    name: 'ifRenderThreadQueue',
    description: 'Queues messages for handlers on the render thread, enabling async communication from Task nodes without blocking.',
    docsUrl: 'https://developer.roku.com/dev/docs/ifrenderthreadqueue',
    methods: [
      { name: 'AddMessageHandler', signature: 'AddMessageHandler(message_id as String, handler as String) as Object', returnType: 'Object', description: 'Registers a handler for messages on the given ID. Called on the render thread. Returns an object to unregister the handler.', since: '15.0' },
      { name: 'PostMessage', signature: 'PostMessage(message_id as String, data as Object) as Void', returnType: 'Void', description: 'Posts a message to the queue. Data is moved and becomes unavailable to the calling thread. May be called from any thread.', since: '15.0' },
      { name: 'CopyMessage', signature: 'CopyMessage(message_id as String, data as Object) as Void', returnType: 'Void', description: 'Posts a message to the queue. Data is copied instead of moved. May be called from any thread.', since: '15.0' },
      { name: 'NumCopies', signature: 'NumCopies() as Integer', returnType: 'Integer', description: 'Returns the total number of objects that were copied by PostMessage() instead of being moved.', since: '15.0' },
    ],
  },

  // ── ifUtils ───────────────────────────────────────────────────────────────
  ifUtils: {
    name: 'ifUtils',
    description: 'Utility functions for deep copying and object identity comparison.',
    docsUrl: 'https://developer.roku.com/dev/docs/ifutils',
    methods: [
      { name: 'DeepCopy', signature: 'DeepCopy(data as Object) as Object', returnType: 'Object', description: 'Performs a deep copy of an object and all nested objects. Non-copyable items are skipped.', since: '15.0' },
      { name: 'IsSameObject', signature: 'IsSameObject(data1 as Object, data2 as Object) as Boolean', returnType: 'Boolean', description: 'Returns true if both arguments reference the same object instance.', since: '15.0' },
      { name: 'HasComponent', signature: 'HasComponent(component as String) as Boolean', returnType: 'Boolean', description: 'Returns true when the named component is available on this device.', since: '15.2' },
    ],
  },

  // ── ifFileSystem ─────────────────────────────────────────────────────────
  ifFileSystem: {
    name: 'ifFileSystem',
    description: 'Filesystem navigation and file operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iffilesystem.md',
    methods: [
      { name: 'GetVolumeList', signature: 'GetVolumeList() as Object', returnType: 'roArray', description: 'Returns an roArray of volume path strings (e.g. "tmp:", "pkg:", "ext1:").' },
      { name: 'GetDirectoryListing', signature: 'GetDirectoryListing(path as String) as Object', returnType: 'roArray', description: 'Returns an roArray of filename strings in the given directory.' },
      { name: 'CreateDirectory', signature: 'CreateDirectory(path as String) as Boolean', returnType: 'Boolean', description: 'Creates the directory at path. Returns true on success.' },
      { name: 'Delete', signature: 'Delete(path as String) as Boolean', returnType: 'Boolean', description: 'Deletes the file or empty directory at path.' },
      { name: 'CopyFile', signature: 'CopyFile(source as String, destination as String) as Boolean', returnType: 'Boolean', description: 'Copies a file. Returns true on success.' },
      { name: 'Rename', signature: 'Rename(fromPath as String, toPath as String) as Boolean', returnType: 'Boolean', description: 'Renames fromPath to toPath. Returns true on success.' },
      { name: 'Exists', signature: 'Exists(path as String) as Boolean', returnType: 'Boolean', description: 'Returns true if the file or directory exists.' },
      { name: 'Stat', signature: 'Stat(path as String) as Object', returnType: 'roAssociativeArray', description: 'Returns metadata for path: "type" (file/directory), "size", "permissions", "ctime", "mtime".' },
      { name: 'Find', signature: 'Find(rootDir as String, pattern as String) as Object', returnType: 'roArray', description: 'Finds files matching pattern directly under rootDir.' },
      { name: 'FindRecurse', signature: 'FindRecurse(rootDir as String, pattern as String) as Object', returnType: 'roArray', description: 'Recursively finds files matching pattern under rootDir.' },
      { name: 'Match', signature: 'Match(path as String, pattern as String) as Object', returnType: 'Object', description: 'Returns files matching a glob pattern in the given path.' },
      { name: 'GetVolumeInfo', signature: 'GetVolumeInfo(path as String) as Object', returnType: 'Object', description: 'Returns volume information for the given path.' },
    ],
  },

  // ── ifPath ───────────────────────────────────────────────────────────────
  ifPath: {
    name: 'ifPath',
    description: 'File path parsing and manipulation.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifpath.md',
    methods: [
      { name: 'Change', signature: 'Change(pathComponent as String) as Object', returnType: 'roPath', description: 'Returns a new roPath with pathComponent applied (relative or absolute).' },
      { name: 'IsValid', signature: 'IsValid() as Boolean', returnType: 'Boolean', description: 'Returns true if the path is syntactically valid.' },
      { name: 'Split', signature: 'Split() as Object', returnType: 'roAssociativeArray', description: 'Returns AA with keys: "basename", "filename", "extension", "parent".' },
    ],
  },

  // ── ifDeviceInfo ─────────────────────────────────────────────────────────
  ifDeviceInfo: {
    name: 'ifDeviceInfo',
    description: 'Device hardware, firmware, network, and display information.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifdeviceinfo.md',
    methods: [
      { name: 'GetModel', signature: 'GetModel() as String', returnType: 'String', description: 'Returns the Roku device model number (e.g. "4640X").' },
      { name: 'GetModelDisplayName', signature: 'GetModelDisplayName() as String', returnType: 'String', description: 'Returns the human-readable model name (e.g. "Roku Express").' },
      { name: 'GetVersion', signature: 'GetVersion() as String', returnType: 'String', description: 'Returns the OS version as a dotted string.' },
      { name: 'GetOSVersion', signature: 'GetOSVersion() as Object', returnType: 'roAssociativeArray', description: 'Returns AA with keys "major", "minor", "revision", "build".' },
      { name: 'GetRIDA', signature: 'GetRIDA() as String', returnType: 'String', description: 'Returns the Roku ID for Advertising (RIDA).' },
      { name: 'IsRIDADisabled', signature: 'IsRIDADisabled() as Boolean', returnType: 'Boolean', description: 'Returns true if the user has opted out of ad tracking.' },
      { name: 'GetChannelClientId', signature: 'GetChannelClientId() as String', returnType: 'String', description: 'Returns a unique channel-specific device identifier.' },
      { name: 'GetUserCountryCode', signature: 'GetUserCountryCode() as String', returnType: 'String', description: 'Returns the ISO 3166-1 alpha-2 country code of the user\'s Roku account.' },
      { name: 'GetCurrentLocale', signature: 'GetCurrentLocale() as String', returnType: 'String', description: 'Returns the current locale (e.g. "en_US").' },
      { name: 'GetLinkStatus', signature: 'GetLinkStatus() as Boolean', returnType: 'Boolean', description: 'Returns true if the network interface has a link.' },
      { name: 'GetInternetStatus', signature: 'GetInternetStatus() as Boolean', returnType: 'Boolean', description: 'Returns true if internet connectivity is available.' },
      { name: 'GetConnectionType', signature: 'GetConnectionType() as String', returnType: 'String', description: 'Returns "WiFiConnection", "WiredConnection", or "".' },
      { name: 'GetIPAddrs', signature: 'GetIPAddrs() as Object', returnType: 'roAssociativeArray', description: 'Returns an AA mapping interface names to IP addresses.' },
      { name: 'GetConnectionInfo', signature: 'GetConnectionInfo() as Object', returnType: 'roAssociativeArray', description: 'Returns detailed network connection information.' },
      { name: 'GetDisplayType', signature: 'GetDisplayType() as String', returnType: 'String', description: 'Returns "HDTV" or "SDTV".' },
      { name: 'GetDisplayMode', signature: 'GetDisplayMode() as String', returnType: 'String', description: 'Returns current display mode, e.g. "1080p".' },
      { name: 'GetDisplayAspectRatio', signature: 'GetDisplayAspectRatio() as String', returnType: 'String', description: 'Returns "16x9" or "4x3".' },
      { name: 'GetDisplaySize', signature: 'GetDisplaySize() as Object', returnType: 'roAssociativeArray', description: 'Returns AA with "w" (width) and "h" (height) in pixels.' },
      { name: 'GetVideoMode', signature: 'GetVideoMode() as String', returnType: 'String', description: 'Returns the video output mode (e.g. "1080p60").' },
      { name: 'GetUIResolution', signature: 'GetUIResolution() as Object', returnType: 'roAssociativeArray', description: 'Returns AA with "name", "width", "height" for the UI coordinate space.' },
      { name: 'GetAudioOutputChannel', signature: 'GetAudioOutputChannel() as String', returnType: 'String', description: 'Returns current audio output: "Stereo", "5.1 surround", etc.' },
      { name: 'GetSoundEffectsVolume', signature: 'GetSoundEffectsVolume() as Integer', returnType: 'Integer', description: 'Returns the UI sound effects volume (0–100).' },
      { name: 'IsAudioGuideEnabled', signature: 'IsAudioGuideEnabled() as Boolean', returnType: 'Boolean', description: 'Returns true if audio guide (text-to-speech) is enabled.' },
      { name: 'IsHDMIConnected', signature: 'IsHDMIConnected() as Boolean', returnType: 'Boolean', description: 'Returns true if an HDMI display is connected.' },
      { name: 'HasFeature', signature: 'HasFeature(feature as String) as Boolean', returnType: 'Boolean', description: 'Returns true if the device supports the named feature (e.g. "5.1_surround_sound").' },
      { name: 'GetRandomUUID', signature: 'GetRandomUUID() as String', returnType: 'String', description: 'Returns a randomly generated UUID v4 string.' },
      { name: 'GetCaptionsMode', signature: 'GetCaptionsMode() as String', returnType: 'String', description: 'Returns the current captions mode: "On", "Off", or "Instant replay".' },
      { name: 'SetCaptionsMode', signature: 'SetCaptionsMode(mode as String) as Boolean', returnType: 'Boolean', description: 'Sets the captions mode. Returns true on success.' },
      { name: 'GetCaptionsOption', signature: 'GetCaptionsOption(option as String) as String', returnType: 'String', description: 'Returns the value of a captions display option.' },
      { name: 'GetClockFormat', signature: 'GetClockFormat() as String', returnType: 'String', description: 'Returns "12h" or "24h" based on user preference.' },
      { name: 'EnableLinkStatusEvent', signature: 'EnableLinkStatusEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables roDeviceInfoEvent notifications when network link status changes.' },
      { name: 'EnableInternetStatusEvent', signature: 'EnableInternetStatusEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables roDeviceInfoEvent notifications when internet connectivity changes.' },
      { name: 'EnableAudioGuideChangedEvent', signature: 'EnableAudioGuideChangedEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables roDeviceInfoEvent notifications when audio guide status changes.' },
      { name: 'GetModelType', signature: 'GetModelType() as String', returnType: 'String', description: 'Returns the model type (STB or TV).' },
      { name: 'GetModelDetails', signature: 'GetModelDetails() as Object', returnType: 'Object', description: 'Returns an AA with model hardware details.' },
      { name: 'GetFriendlyName', signature: 'GetFriendlyName() as String', returnType: 'String', description: 'Returns the user-assigned friendly device name.' },
      { name: 'GetDeviceUniqueId', signature: 'GetDeviceUniqueId() as String', returnType: 'String', description: 'Returns a unique device identifier.', deprecated: true, deprecationNote: 'Use GetChannelClientId() instead.' },
      { name: 'GetAdvertisingId', signature: 'GetAdvertisingId() as String', returnType: 'String', description: 'Returns the Roku advertising identifier.', deprecated: true, deprecationNote: 'Use GetRIDA() instead.' },
      { name: 'IsAdIdTrackingDisabled', signature: 'IsAdIdTrackingDisabled() as Boolean', returnType: 'Boolean', description: 'Returns true if ad tracking is disabled by the user.', deprecated: true, deprecationNote: 'Use IsRIDADisabled() instead.' },
      { name: 'GetClientTrackingId', signature: 'GetClientTrackingId() as String', returnType: 'String', description: 'Returns a channel-scoped tracking ID.', deprecated: true, deprecationNote: 'Use GetChannelClientId() instead.' },
      { name: 'GetTimeZone', signature: 'GetTimeZone() as String', returnType: 'String', description: 'Returns the system time zone name.' },
      { name: 'GetCountryCode', signature: 'GetCountryCode() as String', returnType: 'String', description: 'Returns the ISO 3166-1 country code for the Roku account.' },
      { name: 'GetPreferredCaptionLanguage', signature: 'GetPreferredCaptionLanguage() as String', returnType: 'String', description: 'Returns the preferred caption language code.' },
      { name: 'TimeSinceLastKeypress', signature: 'TimeSinceLastKeypress() as Integer', returnType: 'Integer', description: 'Returns seconds since the last remote keypress.' },
      { name: 'GetDrmInfo', signature: 'GetDrmInfo() as Object', returnType: 'Object', description: 'Returns DRM system information.', deprecated: true, deprecationNote: 'Use GetDrmInfoEx() instead.' },
      { name: 'GetDrmInfoEx', signature: 'GetDrmInfoEx() as Object', returnType: 'Object', description: 'Returns extended DRM system information.' },
      { name: 'IsClockValid', signature: 'IsClockValid() as Boolean', returnType: 'Boolean', description: 'Returns true if the device clock has been set from a time server.' },
      { name: 'EnableValidClockEvent', signature: 'EnableValidClockEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables/disables roDeviceInfoEvent for clock validation.' },
      { name: 'EnableAppFocusEvent', signature: 'EnableAppFocusEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables/disables app focus/blur events.' },
      { name: 'EnableScreensaverExitedEvent', signature: 'EnableScreensaverExitedEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables/disables screensaver-exited events.' },
      { name: 'EnableLowGeneralMemoryEvent', signature: 'EnableLowGeneralMemoryEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables/disables low-memory warning events.' },
      { name: 'GetGeneralMemoryLevel', signature: 'GetGeneralMemoryLevel() as String', returnType: 'String', description: 'Returns the general memory level (normal, low, critical).' },
      { name: 'IsStoreDemoMode', signature: 'IsStoreDemoMode() as Boolean', returnType: 'Boolean', description: 'Returns true if the device is in retail demo mode.' },
      { name: 'GetUptimeMillisecondsAsLong', signature: 'GetUptimeMillisecondsAsLong() as LongInteger', returnType: 'LongInteger', description: 'Returns device uptime in milliseconds.' },
      { name: 'ForceInternetStatusCheck', signature: 'ForceInternetStatusCheck() as Boolean', returnType: 'Boolean', description: 'Forces an immediate internet connectivity check.' },
      { name: 'GetExternalIp', signature: 'GetExternalIp() as String', returnType: 'String', description: 'Returns the device external IP address.' },
      { name: 'GetDisplayProperties', signature: 'GetDisplayProperties() as Object', returnType: 'Object', description: 'Returns display properties including HDR support.' },
      { name: 'GetSupportedGraphicsResolutions', signature: 'GetSupportedGraphicsResolutions() as Object', returnType: 'Object', description: 'Returns supported UI graphics resolutions.' },
      { name: 'CanDecodeVideo', signature: 'CanDecodeVideo(options as Object) as Object', returnType: 'Object', description: 'Checks if the device can decode a video format.' },
      { name: 'GetGraphicsPlatform', signature: 'GetGraphicsPlatform() as String', returnType: 'String', description: 'Returns the graphics platform (opengl or directfb).' },
      { name: 'GetVideoDecodeInfo', signature: 'GetVideoDecodeInfo() as Object', returnType: 'Object', description: 'Returns video decoder information.', deprecated: true, deprecationNote: 'Use CanDecodeVideo() instead.' },
      { name: 'EnableCodecCapChangedEvent', signature: 'EnableCodecCapChangedEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables/disables codec capability change events.' },
      { name: 'GetAudioDecodeInfo', signature: 'GetAudioDecodeInfo() as Object', returnType: 'Object', description: 'Returns audio decoder information.', deprecated: true, deprecationNote: 'Use CanDecodeAudio() instead.' },
      { name: 'CanDecodeAudio', signature: 'CanDecodeAudio(options as Object) as Object', returnType: 'Object', description: 'Checks if the device can decode an audio format.' },
      { name: 'IsPassthruCodecActive', signature: 'IsPassthruCodecActive() as Boolean', returnType: 'Boolean', description: 'Returns true if audio is being passed through to an external receiver.' },
      { name: 'IsAutoplayEnabled', signature: 'IsAutoplayEnabled() as Boolean', returnType: 'Boolean', description: 'Returns true if the user has enabled autoplay.' },
      { name: 'isAutoAdjustRefreshRateEnabled', signature: 'isAutoAdjustRefreshRateEnabled() as Boolean', returnType: 'Boolean', description: 'Returns true if auto-adjust display refresh rate is enabled.' },
    ],
  },

  // ── ifAppInfo ────────────────────────────────────────────────────────────
  ifAppInfo: {
    name: 'ifAppInfo',
    description: 'Information about the currently running channel.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifappinfo.md',
    methods: [
      { name: 'GetID', signature: 'GetID() as String', returnType: 'String', description: 'Returns the channel ID (e.g. "dev" for sideloaded channels).' },
      { name: 'IsDev', signature: 'IsDev() as Boolean', returnType: 'Boolean', description: 'Returns true if running as a sideloaded (development) channel.' },
      { name: 'GetVersion', signature: 'GetVersion() as String', returnType: 'String', description: 'Returns the channel version string from the manifest.' },
      { name: 'GetTitle', signature: 'GetTitle() as String', returnType: 'String', description: 'Returns the channel title from the manifest.' },
      { name: 'GetDevID', signature: 'GetDevID() as String', returnType: 'String', description: 'Returns the developer ID associated with the channel.' },
      { name: 'GetValue', signature: 'GetValue(key as String) as String', returnType: 'String', description: 'Returns the value of any manifest key.' },
    ],
  },

  // ── ifRegistry ───────────────────────────────────────────────────────────
  ifRegistry: {
    name: 'ifRegistry',
    description: 'Channel persistent storage — top-level registry operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifregistry.md',
    methods: [
      { name: 'GetSectionList', signature: 'GetSectionList() as Object', returnType: 'roArray', description: 'Returns an roArray of section name strings.' },
      { name: 'Delete', signature: 'Delete(section as String) as Boolean', returnType: 'Boolean', description: 'Deletes the entire section and all its keys.' },
      { name: 'Flush', signature: 'Flush() as Boolean', returnType: 'Boolean', description: 'Writes any pending changes to persistent storage.' },
      { name: 'GetSpaceAvailable', signature: 'GetSpaceAvailable() as Integer', returnType: 'Integer', description: 'Returns the number of bytes available in the registry.' },
    ],
  },

  // ── ifRegistrySection ────────────────────────────────────────────────────
  ifRegistrySection: {
    name: 'ifRegistrySection',
    description: 'Per-section registry key-value operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifregistrysection.md',
    methods: [
      { name: 'Read', signature: 'Read(key as String) as String', returnType: 'String', description: 'Returns the value of key, or an empty string if not found.' },
      { name: 'ReadMulti', signature: 'ReadMulti(keys as Object) as Object', returnType: 'roAssociativeArray', description: 'Returns an AA of values for all requested keys.' },
      { name: 'Write', signature: 'Write(key as String, value as String) as Boolean', returnType: 'Boolean', description: 'Writes key=value. Returns true on success.' },
      { name: 'WriteMulti', signature: 'WriteMulti(values as Object) as Boolean', returnType: 'Boolean', description: 'Writes multiple key-value pairs at once.' },
      { name: 'Delete', signature: 'Delete(key as String) as Boolean', returnType: 'Boolean', description: 'Deletes key. Returns true if it existed.' },
      { name: 'Exists', signature: 'Exists(key as String) as Boolean', returnType: 'Boolean', description: 'Returns true if key exists in this section.' },
      { name: 'Flush', signature: 'Flush() as Boolean', returnType: 'Boolean', description: 'Persists changes. Returns true on success.' },
      { name: 'GetKeyList', signature: 'GetKeyList() as Object', returnType: 'roArray', description: 'Returns an roArray of all key names in this section.' },
    ],
  },

  // ── ifSGNode ─────────────────────────────────────────────────────────────
  ifSGNode: {
    name: 'ifSGNode',
    description: 'SceneGraph node tree and field operations.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsgnode.md',
    methods: [
      { name: 'CreateChild', signature: 'CreateChild(nodeType as String) as Object', returnType: 'roSGNode', description: 'Creates and appends a child node of nodeType. Returns the new node.' },
      { name: 'RemoveChild', signature: 'RemoveChild(child as Object) as Boolean', returnType: 'Boolean', description: 'Removes child from this node\'s children. Returns true if found.' },
      { name: 'RemoveChildren', signature: 'RemoveChildren(children as Object) as Void', returnType: 'Void', description: 'Removes an array of children at once.' },
      { name: 'GetParent', signature: 'GetParent() as Object', returnType: 'roSGNode', description: 'Returns the parent node, or invalid if root.' },
      { name: 'GetScene', signature: 'GetScene() as Object', returnType: 'roSGNode', description: 'Returns the scene (root) node.' },
      { name: 'GetChildCount', signature: 'GetChildCount() as Integer', returnType: 'Integer', description: 'Returns the number of direct children.' },
      { name: 'GetChild', signature: 'GetChild(index as Integer) as Object', returnType: 'roSGNode', description: 'Returns the child at the given zero-based index.' },
      { name: 'GetChildren', signature: 'GetChildren(count as Integer, startIndex as Integer) as Object', returnType: 'roArray', description: 'Returns count children starting at startIndex.' },
      { name: 'AppendChild', signature: 'AppendChild(child as Object) as Boolean', returnType: 'Boolean', description: 'Appends child to the end of this node\'s children.' },
      { name: 'InsertChild', signature: 'InsertChild(child as Object, index as Integer) as Boolean', returnType: 'Boolean', description: 'Inserts child at the given index.' },
      { name: 'ReplaceChild', signature: 'ReplaceChild(newChild as Object, index as Integer) as Boolean', returnType: 'Boolean', description: 'Replaces the child at index with newChild.' },
      { name: 'RemoveChildIndex', signature: 'RemoveChildIndex(index as Integer) as Boolean', returnType: 'Boolean', description: 'Removes the child at the given index.' },
      { name: 'FindNode', signature: 'FindNode(id as String) as Object', returnType: 'roSGNode', description: 'Returns the first descendant (or self) with the given "id" field, or invalid.' },
      { name: 'HasField', signature: 'HasField(field as String) as Boolean', returnType: 'Boolean', description: 'Returns true if this node has the named field.' },
      { name: 'GetField', signature: 'GetField(field as String) as Dynamic', returnType: 'Dynamic', description: 'Returns the value of the named field.' },
      { name: 'GetFields', signature: 'GetFields() as Object', returnType: 'roAssociativeArray', description: 'Returns an AA of all field names and their current values.' },
      { name: 'SetField', signature: 'SetField(field as String, value as Dynamic) as Boolean', returnType: 'Boolean', description: 'Sets a single field. Returns true on success.' },
      { name: 'SetFields', signature: 'SetFields(fields as Object) as Boolean', returnType: 'Boolean', description: 'Sets multiple fields from an AA. Returns true on success.' },
      { name: 'Update', signature: 'Update(fields as Object, addFields = false as Boolean) as Void', returnType: 'Void', description: 'Batches field updates. When addFields=true, also adds new fields.' },
      { name: 'ObserveField', signature: 'ObserveField(field as String, portOrFunction as Dynamic) as Boolean', returnType: 'Boolean', description: 'Observes field changes. Arg2 can be an roMessagePort or a callback function name string.' },
      { name: 'ObserveFieldScoped', signature: 'ObserveFieldScoped(field as String, functionName as String) as Boolean', returnType: 'Boolean', description: 'Observes field changes within the current component scope.' },
      { name: 'UnobserveField', signature: 'UnobserveField(field as String) as Boolean', returnType: 'Boolean', description: 'Stops observing the named field.' },
      { name: 'UnobserveFieldScoped', signature: 'UnobserveFieldScoped(field as String) as Boolean', returnType: 'Boolean', description: 'Stops scoped observation of the named field.' },
      { name: 'GetType', signature: 'GetType() as String', returnType: 'String', description: 'Returns the node type string (e.g. "Label", "Rectangle").' },
      { name: 'SubType', signature: 'SubType() as String', returnType: 'String', description: 'Returns the node\'s most specific type (same as GetType for most nodes).' },
      { name: 'IsSubtype', signature: 'IsSubtype(nodeType as String) as Boolean', returnType: 'Boolean', description: 'Returns true if this node is of nodeType or a subtype.' },
      { name: 'CallFunc', signature: 'CallFunc(functionName as String, args as Dynamic) as Dynamic', returnType: 'Dynamic', description: 'Calls the named function on this node, passing args. Used for cross-component calls.' },
      { name: 'GetId', signature: 'GetId() as String', returnType: 'String', description: 'Returns the "id" field of the node.' },
      { name: 'SetFocus', signature: 'SetFocus(focusState as Boolean) as Boolean', returnType: 'Boolean', description: 'Sets or clears input focus on this node.' },
      { name: 'HasFocus', signature: 'HasFocus() as Boolean', returnType: 'Boolean', description: 'Returns true if this node currently has keyboard focus.' },
      { name: 'IsInFocusChain', signature: 'IsInFocusChain() as Boolean', returnType: 'Boolean', description: 'Returns true if this node is in the focus chain.' },
      { name: 'GetFocusedChild', signature: 'GetFocusedChild() as Object', returnType: 'roSGNode', description: 'Returns the focused descendant of this node, or invalid.' },
      { name: 'SignalBeacon', signature: 'SignalBeacon(signal as String) as Boolean', returnType: 'Boolean', description: 'Signals a performance beacon event (e.g. "AppLaunchComplete").' },
      { name: 'IsInSubtree', signature: 'IsInSubtree(nodeToFind as Object) as Boolean', returnType: 'Boolean', description: 'Returns true if nodeToFind is this node or a descendant.' },
    ],
  },

  // ── ifSGScreen ───────────────────────────────────────────────────────────
  ifSGScreen: {
    name: 'ifSGScreen',
    description: 'SceneGraph screen lifecycle management.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsgscreen.md',
    methods: [
      { name: 'CreateScene', signature: 'CreateScene(sceneType as String) as Object', returnType: 'roSGNode', description: 'Creates and returns the root scene node of the given type.' },
      { name: 'Show', signature: 'Show() as Void', returnType: 'Void', description: 'Makes the SceneGraph screen visible and starts rendering.' },
      { name: 'Close', signature: 'Close() as Void', returnType: 'Void', description: 'Closes and destroys the SceneGraph screen.' },
      { name: 'GetScene', signature: 'GetScene() as Object', returnType: 'roSGNode', description: 'Returns the root scene node.' },
      { name: 'GetMessagePort', signature: 'GetMessagePort() as Object', returnType: 'Object', description: 'Returns the message port set for this screen.' },
      { name: 'SetMessagePort', signature: 'SetMessagePort(port as Object) as Void', returnType: 'Void', description: 'Sets the roMessagePort that receives events from this screen.' },
      { name: 'getGlobalNode', signature: 'getGlobalNode() as Object', returnType: 'Object', description: 'Returns the screen-wide global node. Roku documents this name with a lowercase first letter.' },
    ],
  },

  // ── ifAudioPlayer ────────────────────────────────────────────────────────
  ifAudioPlayer: {
    name: 'ifAudioPlayer',
    description: 'Background audio playback control.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifaudioplayer.md',
    methods: [
      { name: 'Play', signature: 'Play() as Boolean', returnType: 'Boolean', description: 'Starts or resumes playback. Returns true on success.' },
      { name: 'Stop', signature: 'Stop() as Boolean', returnType: 'Boolean', description: 'Stops playback and resets position.' },
      { name: 'Pause', signature: 'Pause() as Boolean', returnType: 'Boolean', description: 'Pauses playback at the current position.' },
      { name: 'Resume', signature: 'Resume() as Boolean', returnType: 'Boolean', description: 'Resumes from a paused position.' },
      { name: 'SetContentList', signature: 'SetContentList(contentList as Object) as Void', returnType: 'Void', description: 'Sets the entire playlist from an roArray of content metadata AAs.' },
      { name: 'AddContent', signature: 'AddContent(content as Object) as Void', returnType: 'Void', description: 'Appends a single content metadata AA to the playlist.' },
      { name: 'ClearContent', signature: 'ClearContent() as Void', returnType: 'Void', description: 'Removes all items from the playlist.' },
      { name: 'SetNext', signature: 'SetNext(itemIndex as Integer) as Boolean', returnType: 'Boolean', description: 'Queues the item at itemIndex to play next.' },
      { name: 'Seek', signature: 'Seek(offsetMs as Integer) as Boolean', returnType: 'Boolean', description: 'Seeks to offsetMs milliseconds from the start of the current item.' },
      { name: 'SetLoop', signature: 'SetLoop(loop as Boolean) as Void', returnType: 'Void', description: 'When true, the playlist loops indefinitely.' },
      { name: 'SetTimedMetadataForKeys', signature: 'SetTimedMetadataForKeys(keys as Object) as Void', returnType: 'Void', description: 'Specifies which timed metadata keys to surface as events.' },
    ],
  },

  // ── ifEVPDigest ──────────────────────────────────────────────────────────
  ifEVPDigest: {
    name: 'ifEVPDigest',
    description: 'Incremental cryptographic hash computation (MD5, SHA-1, SHA-256, etc.).',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifevpdigest.md',
    methods: [
      { name: 'Setup', signature: 'Setup(algorithm as String) as Integer', returnType: 'Integer', description: 'Initialises the digest for algorithm (e.g. "md5", "sha256"). Returns 0 on success.' },
      { name: 'Update', signature: 'Update(data as Object) as Integer', returnType: 'Integer', description: 'Feeds data (roByteArray or String) into the digest. Returns 0 on success.' },
      { name: 'Final', signature: 'Final() as Object', returnType: 'roByteArray', description: 'Finalises and returns the digest as an roByteArray.' },
      { name: 'Process', signature: 'Process(algorithm as String, data as Object) as Object', returnType: 'roByteArray', description: 'Convenience: hash data in a single call. Returns the digest as an roByteArray.' },
      { name: 'Reinit', signature: 'Reinit() as Integer', returnType: 'Integer', description: 'Reinitializes the digest context.' },
    ],
  },

  // ── ifEVPCipher ──────────────────────────────────────────────────────────
  ifEVPCipher: {
    name: 'ifEVPCipher',
    description: 'Symmetric encryption/decryption using OpenSSL EVP ciphers.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifevpcipher.md',
    methods: [
      { name: 'Setup', signature: 'Setup(encrypt as Boolean, algorithm as String, key as Object, iv as Object) as Integer', returnType: 'Integer', description: 'Initialises the cipher. encrypt=true to encrypt, false to decrypt. Returns 0 on success.' },
      { name: 'Process', signature: 'Process(data as Object) as Object', returnType: 'roByteArray', description: 'Processes data through the cipher and returns the result.' },
      { name: 'Final', signature: 'Final() as Object', returnType: 'roByteArray', description: 'Finalises the cipher operation and returns any remaining output.' },
      { name: 'Reinit', signature: 'Reinit() as Integer', returnType: 'Integer', description: 'Reinitializes the cipher context.' },
      { name: 'Update', signature: 'Update(data as Object) as Object', returnType: 'Object', description: 'Processes a chunk of data; call multiple times before Final.' },
    ],
  },

  // ── ifHMAC ───────────────────────────────────────────────────────────────
  ifHMAC: {
    name: 'ifHMAC',
    description: 'HMAC message authentication codes.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifhmac.md',
    methods: [
      { name: 'Setup', signature: 'Setup(algorithm as String, key as Object) as Integer', returnType: 'Integer', description: 'Initialises HMAC with algorithm and key (roByteArray). Returns 0 on success.' },
      { name: 'Update', signature: 'Update(data as Object) as Integer', returnType: 'Integer', description: 'Feeds data into the HMAC computation.' },
      { name: 'Final', signature: 'Final() as Object', returnType: 'roByteArray', description: 'Returns the finalised HMAC digest.' },
      { name: 'Process', signature: 'Process(algorithm as String, key as Object, data as Object) as Object', returnType: 'roByteArray', description: 'Convenience: compute HMAC in one call.' },
      { name: 'Reinit', signature: 'Reinit() as Integer', returnType: 'Integer', description: 'Reinitializes the HMAC context.' },
    ],
  },

  // ── ifListToArray ─────────────────────────────────────────────────────────
  ifListToArray: {
    name: 'ifListToArray',
    description: 'Converts a linked list to an array.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iflisttoarray.md',
    methods: [
      { name: 'ToArray', signature: 'ToArray() as Object', returnType: 'roArray', description: 'Returns an roArray containing all elements of the list in order.' },
    ],
  },

  // ── ifVideoPlayer ────────────────────────────────────────────────────────
  ifVideoPlayer: {
    name: 'ifVideoPlayer',
    description: 'Video playback control with content list, seeking, and track management.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifvideoplayer.md',
    methods: [
      { name: 'SetContentList', signature: 'SetContentList(contentList as Object) as Void', returnType: 'Void', description: 'Sets the content list to be played from an roArray of content metadata AAs. Resets position if called during playback.' },
      { name: 'AddContent', signature: 'AddContent(contentItem as Object) as Void', returnType: 'Void', description: 'Appends a single content metadata AA to the existing playlist.' },
      { name: 'ClearContent', signature: 'ClearContent() as Void', returnType: 'Void', description: 'Removes all content from the player and stops playback.' },
      { name: 'Play', signature: 'Play() as Boolean', returnType: 'Boolean', description: 'Starts or resumes video playback. Returns true on success.' },
      { name: 'Stop', signature: 'Stop() as Boolean', returnType: 'Boolean', description: 'Stops playback and resets seek position. Returns true on success.' },
      { name: 'Pause', signature: 'Pause() as Boolean', returnType: 'Boolean', description: 'Pauses playback at the current position. Returns true on success.' },
      { name: 'Resume', signature: 'Resume() as Boolean', returnType: 'Boolean', description: 'Resumes from a paused position. Returns true on success.' },
      { name: 'PreBuffer', signature: 'PreBuffer() as Boolean', returnType: 'Boolean', description: 'Begins downloading and buffering content before playback starts.' },
      { name: 'SetNext', signature: 'SetNext(itemIndex as Integer) as Void', returnType: 'Void', description: 'Specifies which zero-based content item plays after the current one finishes.' },
      { name: 'SetLoop', signature: 'SetLoop(loop as Boolean) as Void', returnType: 'Void', description: 'Enables automatic replay of the entire playlist when it finishes.' },
      { name: 'Seek', signature: 'Seek(offsetMs as Integer) as Boolean', returnType: 'Boolean', description: 'Seeks to a specific millisecond offset within the current item. Returns true on success.' },
      { name: 'SetEnableAudio', signature: 'SetEnableAudio(enable as Boolean) as Void', returnType: 'Void', description: 'Mutes or unmutes audio during playback.' },
      { name: 'GetAudioTracks', signature: 'GetAudioTracks() as Object', returnType: 'roArray', description: 'Returns an roArray of available audio tracks, each an AA with language, identifier, name, and format.' },
      { name: 'ChangeAudioTrack', signature: 'ChangeAudioTrack(trackID as String) as Void', returnType: 'Void', description: 'Switches to the audio track with the given identifier.' },
      { name: 'SetDestinationRect', signature: 'SetDestinationRect(x as Integer, y as Integer, w as Integer, h as Integer) as Void', returnType: 'Void', description: 'Sets the video display window position and size in UI coordinates.' },
      { name: 'SetMaxVideoDecodeResolution', signature: 'SetMaxVideoDecodeResolution(width as Integer, height as Integer) as Void', returnType: 'Void', description: 'Hints the maximum decode resolution to optimise memory allocation.' },
      { name: 'GetPlaybackDuration', signature: 'GetPlaybackDuration() as Integer', returnType: 'Integer', description: 'Returns the total duration of the current item in seconds, or 0 if unknown.' },
      { name: 'SetPositionNotificationPeriod', signature: 'SetPositionNotificationPeriod(period as Integer) as Void', returnType: 'Void', description: 'Sets the interval in seconds at which playback-position events are fired.' },
      { name: 'SetTimedMetaDataForKeys', signature: 'SetTimedMetaDataForKeys(keys as Dynamic) as Void', returnType: 'Void', description: 'Specifies which timed metadata keys (e.g. ID3 tags) the app should receive as events.' },
      { name: 'GetCaptionRenderer', signature: 'GetCaptionRenderer() as Object', returnType: 'Object', description: 'Returns the roCaptionRenderer instance for custom closed-caption rendering.' },
      { name: 'SetCGMS', signature: 'SetCGMS(level as Integer) as Void', returnType: 'Void', description: 'Sets the Copy Generation Management System level (0–3) on analog outputs.' },
      { name: 'SetMacrovisionLevel', signature: 'SetMacrovisionLevel(level as Integer) as Void', returnType: 'Void', description: 'Sets Macrovision copy protection level (no-op on current devices).', deprecated: true, deprecationNote: 'No longer functional.' },
    ],
  },

  // ── ifAudioResource ──────────────────────────────────────────────────────
  ifAudioResource: {
    name: 'ifAudioResource',
    description: 'Short audio clip and system sound effect playback.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifaudioresource.md',
    methods: [
      { name: 'Trigger', signature: 'Trigger(volume as Integer, index = 0 as Integer) as Void', returnType: 'Void', description: 'Plays the audio resource at volume (0–100). index distinguishes simultaneous streams; same index replaces any currently-playing sound at that index.' },
      { name: 'IsPlaying', signature: 'IsPlaying() as Boolean', returnType: 'Boolean', description: 'Returns true if this audio resource is currently playing.' },
      { name: 'Stop', signature: 'Stop() as Void', returnType: 'Void', description: 'Stops playback of this audio resource immediately.' },
      { name: 'MaxSimulStreams', signature: 'MaxSimulStreams() as Integer', returnType: 'Integer', description: 'Returns the maximum number of simultaneous audio streams the device supports.' },
      { name: 'GetMetaData', signature: 'GetMetaData() as Object', returnType: 'roAssociativeArray', description: 'Returns an AA of audio characteristics: Length (samples), SamplesPerSecond, NumChannels, BitsPerSample.' },
    ],
  },

  // ── ifAudioMetadata ──────────────────────────────────────────────────────
  ifAudioMetadata: {
    name: 'ifAudioMetadata',
    description: 'Reads ID3/Vorbis tags and technical properties from a local audio file.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifaudiometadata.md',
    methods: [
      { name: 'SetUrl', signature: 'SetUrl(url as String) as Void', returnType: 'Void', description: 'Sets the file URL to read metadata from. Only file-based URLs (tmp:, pkg:, ext1:) are supported.' },
      { name: 'GetTags', signature: 'GetTags() as Object', returnType: 'roAssociativeArray', description: 'Returns an AA of standard tags: title, artist, album, composer, comment, genre, year, track.' },
      { name: 'GetAudioProperties', signature: 'GetAudioProperties() as Object', returnType: 'roAssociativeArray', description: 'Returns technical properties: length (seconds), bitrate (kbps), samplerate (Hz), channels.' },
      { name: 'GetCoverArt', signature: 'GetCoverArt() as Object', returnType: 'roAssociativeArray', description: 'Returns an AA with "bytes" (roByteArray) and "type" (MIME string) for embedded cover art, or invalid if none.' },
    ],
  },

  // ── ifImageMetadata ──────────────────────────────────────────────────────
  ifImageMetadata: {
    name: 'ifImageMetadata',
    description: 'Reads EXIF and other metadata from a local image file.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifimagemetadata.md',
    methods: [
      { name: 'SetUrl', signature: 'SetUrl(url as String) as Void', returnType: 'Void', description: 'Sets the image file URL to read metadata from. Only file-based URLs are supported.' },
      { name: 'GetMetaData', signature: 'GetMetaData() as Object', returnType: 'roAssociativeArray', description: 'Returns fundamental image details: dimensions, orientation, creation timestamp, and caption.' },
      { name: 'GetThumbnail', signature: 'GetThumbnail() as Object', returnType: 'roAssociativeArray', description: 'Returns an AA with "bytes" (roByteArray) and "type" for any embedded thumbnail, or invalid if none.' },
      { name: 'GetRawExif', signature: 'GetRawExif() as Object', returnType: 'roAssociativeArray', description: 'Returns the complete raw EXIF metadata structure as a nested AA.' },
      { name: 'GetRawExifTag', signature: 'GetRawExifTag(ifd as Integer, tagnum as Integer) as Dynamic', returnType: 'Dynamic', description: 'Returns a specific raw EXIF tag value by IFD index and tag number, or invalid if absent.' },
    ],
  },

  // ── ifAudioGuide ─────────────────────────────────────────────────────────
  ifAudioGuide: {
    name: 'ifAudioGuide',
    description: 'Accessibility text-to-speech for screen reader support (active only when screen reader is enabled).',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifaudioguide.md',
    methods: [
      { name: 'Say', signature: 'Say(text as String, flushSpeech as Boolean, dontRepeat as Boolean) as Integer', returnType: 'Integer', description: 'Speaks text aloud and returns a speech ID. flushSpeech cancels current utterance first; dontRepeat skips if identical to the last phrase.' },
      { name: 'Flush', signature: 'Flush() as Void', returnType: 'Void', description: 'Immediately stops any currently playing text-to-speech audio.' },
      { name: 'Silence', signature: 'Silence(duration as Integer) as Integer', returnType: 'Integer', description: 'Suppresses application background sound for duration milliseconds to improve clarity. Returns total milliseconds silenced.' },
    ],
  },

  // ── ifTextToSpeech ───────────────────────────────────────────────────────
  ifTextToSpeech: {
    name: 'ifTextToSpeech',
    description: 'General-purpose in-channel text-to-speech with language, voice, volume, rate, and pitch control.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iftexttospeech.md',
    methods: [
      { name: 'Say', signature: 'Say(text as String) as Integer', returnType: 'Integer', description: 'Speaks text and returns a speech ID for tracking via roTextToSpeechEvent.' },
      { name: 'Silence', signature: 'Silence(duration as Integer) as Integer', returnType: 'Integer', description: 'Inserts a silent pause of duration milliseconds. Returns the silence ID.' },
      { name: 'Flush', signature: 'Flush() as Void', returnType: 'Void', description: 'Cancels the current and all queued utterances.' },
      { name: 'IsEnabled', signature: 'IsEnabled() as Boolean', returnType: 'Boolean', description: 'Returns true if text-to-speech is available and enabled on the device.' },
      { name: 'GetAvailableLanguages', signature: 'GetAvailableLanguages() as Object', returnType: 'roArray', description: 'Returns an roArray of available language name strings.' },
      { name: 'SetLanguage', signature: 'SetLanguage(name as String) as Void', returnType: 'Void', description: 'Selects a TTS language by name.' },
      { name: 'GetLanguage', signature: 'GetLanguage() as String', returnType: 'String', description: 'Returns the currently selected TTS language name.' },
      { name: 'GetAvailableVoices', signature: 'GetAvailableVoices() as Object', returnType: 'roArray', description: 'Returns an roArray of available voice name strings.' },
      { name: 'SetVoice', signature: 'SetVoice(name as String) as Void', returnType: 'Void', description: 'Selects a TTS voice by name.' },
      { name: 'GetVoice', signature: 'GetVoice() as String', returnType: 'String', description: 'Returns the currently active TTS voice name.' },
      { name: 'GetVolume', signature: 'GetVolume() as Integer', returnType: 'Integer', description: 'Returns the TTS volume (0–1000; default 1000).' },
      { name: 'SetVolume', signature: 'SetVolume(volume as Integer) as Void', returnType: 'Void', description: 'Sets the TTS speaker volume (0–1000).' },
      { name: 'GetRate', signature: 'GetRate() as Integer', returnType: 'Integer', description: 'Returns the speech rate (-40 to 200; default 0).' },
      { name: 'SetRate', signature: 'SetRate(rate as Integer) as Void', returnType: 'Void', description: 'Sets the speech rate (-40 to 200).' },
      { name: 'GetPitch', signature: 'GetPitch() as Integer', returnType: 'Integer', description: 'Returns the voice pitch (-60 to +60).' },
      { name: 'SetPitch', signature: 'SetPitch(pitch as Integer) as Void', returnType: 'Void', description: 'Sets the voice pitch (-60 to +60).' },
    ],
  },

  // ── ifHttpAgent ──────────────────────────────────────────────────────────
  ifHttpAgent: {
    name: 'ifHttpAgent',
    description: 'Shared HTTP session management: cookies, request headers, and TLS certificates. Implemented by roHttpAgent (standalone) and roVideoPlayer/roAudioPlayer/roTextureManager.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifhttpagent.md',
    methods: [
      { name: 'AddHeader', signature: 'AddHeader(name as String, value as String) as Boolean', returnType: 'Boolean', description: 'Adds a default request header applied to all HTTP requests made by this object.' },
      { name: 'SetHeaders', signature: 'SetHeaders(nameValueMap as Object) as Boolean', returnType: 'Boolean', description: 'Replaces all default headers with the given AssociativeArray of name→value pairs.' },
      { name: 'InitClientCertificates', signature: 'InitClientCertificates() as Boolean', returnType: 'Boolean', description: 'Loads the Roku device\'s built-in client certificate for mutual TLS authentication.' },
      { name: 'SetCertificatesFile', signature: 'SetCertificatesFile(path as String) as Boolean', returnType: 'Boolean', description: 'Loads CA certificates from the given PEM file path.' },
      { name: 'SetCertificatesDepth', signature: 'SetCertificatesDepth(depth as Integer) as Void', returnType: 'Void', description: 'Sets the maximum allowed certificate chain depth for validation.' },
      { name: 'EnableCookies', signature: 'EnableCookies() as Void', returnType: 'Void', description: 'Activates automatic cookie handling from Set-Cookie response headers.' },
      { name: 'GetCookies', signature: 'GetCookies(domain as String, path as String) as Object', returnType: 'roArray', description: 'Returns an roArray of cookie AAs matching the given domain and path.' },
      { name: 'AddCookies', signature: 'AddCookies(cookies as Object) as Boolean', returnType: 'Boolean', description: 'Inserts cookies from an roArray of cookie AAs into the cookie jar.' },
      { name: 'ClearCookies', signature: 'ClearCookies() as Void', returnType: 'Void', description: 'Removes all cached cookies from this agent.' },
    ],
  },

  // ── ifSocket ─────────────────────────────────────────────────────────────
  ifSocket: {
    name: 'ifSocket',
    description: 'Core socket I/O operations shared by both roStreamSocket (TCP) and roDataGramSocket (UDP).',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocket.md',
    methods: [
      { name: 'Send', signature: 'Send(data as Object, startIndex as Integer, length as Integer) as Integer', returnType: 'Integer', description: 'Transmits up to length bytes from an roByteArray starting at startIndex. Returns bytes actually sent.' },
      { name: 'SendStr', signature: 'SendStr(data as String) as Integer', returnType: 'Integer', description: 'Transmits the entire string through the socket. Returns bytes sent.' },
      { name: 'Receive', signature: 'Receive(data as Object, startIndex as Integer, length as Integer) as Integer', returnType: 'Integer', description: 'Reads up to length bytes from the socket into an roByteArray at startIndex. Returns bytes received.' },
      { name: 'ReceiveStr', signature: 'ReceiveStr(length as Integer) as String', returnType: 'String', description: 'Reads up to length bytes from the socket and returns them as a string.' },
      { name: 'Close', signature: 'Close() as Void', returnType: 'Void', description: 'Closes the socket, flushing any pending send-buffer data.' },
      { name: 'SetAddress', signature: 'SetAddress(sockAddr as Object) as Boolean', returnType: 'Boolean', description: 'Binds the socket to the given roSocketAddress (BSD bind). Returns true on success.' },
      { name: 'GetAddress', signature: 'GetAddress() as Object', returnType: 'roSocketAddress', description: 'Returns the roSocketAddress this socket is bound to.' },
      { name: 'SetSendToAddress', signature: 'SetSendToAddress(sockAddr as Object) as Boolean', returnType: 'Boolean', description: 'Sets the remote address for outgoing datagrams (UDP).' },
      { name: 'GetSendToAddress', signature: 'GetSendToAddress() as Object', returnType: 'roSocketAddress', description: 'Returns the configured remote send-to address.' },
      { name: 'GetReceivedFromAddress', signature: 'GetReceivedFromAddress() as Object', returnType: 'roSocketAddress', description: 'Returns the source address of the last received datagram.' },
      { name: 'GetCountRcvBuf', signature: 'GetCountRcvBuf() as Integer', returnType: 'Integer', description: 'Returns the number of bytes currently available in the receive buffer.' },
      { name: 'GetCountSendBuf', signature: 'GetCountSendBuf() as Integer', returnType: 'Integer', description: 'Returns the number of bytes queued in the send buffer.' },
      { name: 'Status', signature: 'Status() as Integer', returnType: 'Integer', description: 'Returns 0 if the last operation succeeded, or a POSIX error code otherwise.' },
    ],
  },

  // ── ifSocketAsync ────────────────────────────────────────────────────────
  ifSocketAsync: {
    name: 'ifSocketAsync',
    description: 'Async socket event notifications. Use with SetMessagePort to receive roSocketEvent messages.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocketasync.md',
    methods: [
      { name: 'IsReadable', signature: 'IsReadable() as Boolean', returnType: 'Boolean', description: 'Returns true if the socket has data available to read without blocking.' },
      { name: 'IsWritable', signature: 'IsWritable() as Boolean', returnType: 'Boolean', description: 'Returns true if the socket can be written without blocking.' },
      { name: 'IsException', signature: 'IsException() as Boolean', returnType: 'Boolean', description: 'Returns true if an error condition or out-of-band data is present.' },
      { name: 'NotifyReadable', signature: 'NotifyReadable(enable as Boolean) as Void', returnType: 'Void', description: 'Enables or disables roSocketEvent delivery when the socket becomes readable.' },
      { name: 'NotifyWritable', signature: 'NotifyWritable(enable as Boolean) as Void', returnType: 'Void', description: 'Enables or disables roSocketEvent delivery when the socket becomes writable.' },
      { name: 'NotifyException', signature: 'NotifyException(enable as Boolean) as Void', returnType: 'Void', description: 'Enables or disables roSocketEvent delivery when the socket has an exception or OOB data.' },
      { name: 'GetID', signature: 'GetID() as Integer', returnType: 'Integer', description: 'Returns a unique socket identifier for matching against roSocketEvent.getSocketID().' },
    ],
  },

  // ── ifSocketAddress ──────────────────────────────────────────────────────
  ifSocketAddress: {
    name: 'ifSocketAddress',
    description: 'IPv4 address and port management for socket endpoints.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocketaddress.md',
    methods: [
      { name: 'SetAddress', signature: 'SetAddress(address as String) as Boolean', returnType: 'Boolean', description: 'Sets the IPv4 address, accepting dotted-quad or hostname with optional port (e.g. "192.168.1.1:8080" or "roku.com"). Returns true on success.' },
      { name: 'GetAddress', signature: 'GetAddress() as String', returnType: 'String', description: 'Returns the IPv4 address in dotted-quad:port format.' },
      { name: 'SetHostName', signature: 'SetHostName(hostname as String) as Boolean', returnType: 'Boolean', description: 'Sets the hostname without changing the port. Returns true on success.' },
      { name: 'GetHostName', signature: 'GetHostName() as String', returnType: 'String', description: 'Returns the hostname string.' },
      { name: 'SetPort', signature: 'SetPort(port as Integer) as Boolean', returnType: 'Boolean', description: 'Sets the port number. Returns true on success.' },
      { name: 'GetPort', signature: 'GetPort() as Integer', returnType: 'Integer', description: 'Returns the port number.' },
      { name: 'IsAddressValid', signature: 'IsAddressValid() as Boolean', returnType: 'Boolean', description: 'Returns true if the object contains a valid resolved IPv4 address.' },
    ],
  },

  // ── ifSocketConnection ───────────────────────────────────────────────────
  ifSocketConnection: {
    name: 'ifSocketConnection',
    description: 'TCP connection lifecycle: connect, listen, and accept.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocketconnection.md',
    methods: [
      { name: 'Connect', signature: 'Connect() as Boolean', returnType: 'Boolean', description: 'Initiates a TCP connection to the address set via SetSendToAddress(). Returns true if connection was established or is in progress.' },
      { name: 'Listen', signature: 'Listen(backlog as Integer) as Boolean', returnType: 'Boolean', description: 'Puts the socket into listening state with the given incoming-connection queue size. Returns true on success.' },
      { name: 'IsListening', signature: 'IsListening() as Boolean', returnType: 'Boolean', description: 'Returns true if Listen() has been successfully called on this socket.' },
      { name: 'Accept', signature: 'Accept() as Object', returnType: 'roStreamSocket', description: 'Accepts a pending incoming TCP connection. Returns a new roStreamSocket, or invalid if no connection is pending.' },
      { name: 'IsConnected', signature: 'IsConnected() as Boolean', returnType: 'Boolean', description: 'Returns true if the socket has a fully established TCP connection.' },
    ],
  },

  // ── ifSocketConnectionOption ─────────────────────────────────────────────
  ifSocketConnectionOption: {
    name: 'ifSocketConnectionOption',
    description: 'TCP-level socket options: keep-alive, linger, max segment size, Nagle algorithm.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocketconnectionoption.md',
    methods: [
      { name: 'GetKeepAlive', signature: 'GetKeepAlive() as Boolean', returnType: 'Boolean', description: 'Returns true if keep-alive packets are enabled.' },
      { name: 'SetKeepAlive', signature: 'SetKeepAlive(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables or disables periodic keep-alive probes. Returns true on success.' },
      { name: 'GetLinger', signature: 'GetLinger() as Integer', returnType: 'Integer', description: 'Returns the linger timeout in seconds (0 = disabled).' },
      { name: 'SetLinger', signature: 'SetLinger(time as Integer) as Boolean', returnType: 'Boolean', description: 'Sets how long close() blocks to flush unsent data. 0 disables linger. Returns true on success.' },
      { name: 'GetMaxSeg', signature: 'GetMaxSeg() as Integer', returnType: 'Integer', description: 'Returns the maximum TCP segment size in bytes.' },
      { name: 'SetMaxSeg', signature: 'SetMaxSeg(size as Integer) as Boolean', returnType: 'Boolean', description: 'Sets the maximum TCP segment size. Returns true on success.' },
      { name: 'GetNoDelay', signature: 'GetNoDelay() as Boolean', returnType: 'Boolean', description: 'Returns true if the Nagle algorithm is disabled (TCP_NODELAY).' },
      { name: 'SetNoDelay', signature: 'SetNoDelay(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Disables the Nagle algorithm for immediate transmission. Returns true on success.' },
    ],
  },

  // ── ifSocketConnectionStatus ─────────────────────────────────────────────
  ifSocketConnectionStatus: {
    name: 'ifSocketConnectionStatus',
    description: 'TCP-specific connection error status checks corresponding to POSIX errno values.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocketconnectionstatus.md',
    methods: [
      { name: 'eConnAborted', signature: 'eConnAborted() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was ECONNABORTED (connection aborted by software).' },
      { name: 'eConnRefused', signature: 'eConnRefused() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was ECONNREFUSED (connection refused by remote peer).' },
      { name: 'eConnReset', signature: 'eConnReset() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was ECONNRESET (connection reset by peer).' },
      { name: 'eIsConn', signature: 'eIsConn() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EISCONN (socket is already connected).' },
      { name: 'eNotConn', signature: 'eNotConn() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was ENOTCONN (socket is not connected).' },
    ],
  },

  // ── ifSocketOption ───────────────────────────────────────────────────────
  ifSocketOption: {
    name: 'ifSocketOption',
    description: 'Low-level socket options: TTL, address reuse, OOB inline, send/receive buffers and timeouts.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocketoption.md',
    methods: [
      { name: 'GetTTL', signature: 'GetTTL() as Integer', returnType: 'Integer', description: 'Returns the IP Time-To-Live (hop limit) for outgoing packets.' },
      { name: 'SetTTL', signature: 'SetTTL(ttl as Integer) as Boolean', returnType: 'Boolean', description: 'Sets the IP TTL for outgoing packets. Returns true on success.' },
      { name: 'GetReuseAddr', signature: 'GetReuseAddr() as Boolean', returnType: 'Boolean', description: 'Returns true if address reuse (SO_REUSEADDR) is enabled.' },
      { name: 'SetReuseAddr', signature: 'SetReuseAddr(reuse as Boolean) as Dynamic', returnType: 'Dynamic', description: 'Enables rapid re-binding of a recently-closed address.' },
      { name: 'GetOOBInline', signature: 'GetOOBInline() as Boolean', returnType: 'Boolean', description: 'Returns true if out-of-band data is processed inline with normal data.' },
      { name: 'SetOOBInline', signature: 'SetOOBInline(inline as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables inline processing of out-of-band data. Returns true on success.' },
      { name: 'GetSendBuf', signature: 'GetSendBuf() as Integer', returnType: 'Integer', description: 'Returns the send buffer size in bytes.' },
      { name: 'SetSendBuf', signature: 'SetSendBuf(size as Integer) as Boolean', returnType: 'Boolean', description: 'Sets the send buffer size in bytes. Returns true on success.' },
      { name: 'GetRcvBuf', signature: 'GetRcvBuf() as Integer', returnType: 'Integer', description: 'Returns the receive buffer size in bytes.' },
      { name: 'SetRcvBuf', signature: 'SetRcvBuf(size as Integer) as Boolean', returnType: 'Boolean', description: 'Sets the receive buffer size in bytes. Returns true on success.' },
      { name: 'GetSendTimeout', signature: 'GetSendTimeout() as Integer', returnType: 'Integer', description: 'Returns the send timeout in seconds.' },
      { name: 'SetSendTimeout', signature: 'SetSendTimeout(timeout as Integer) as Boolean', returnType: 'Boolean', description: 'Sets the send timeout in seconds. Returns true on success.' },
      { name: 'GetReceiveTimeout', signature: 'GetReceiveTimeout() as Integer', returnType: 'Integer', description: 'Returns the receive timeout in seconds.' },
      { name: 'SetReceiveTimeout', signature: 'SetReceiveTimeout(timeout as Integer) as Boolean', returnType: 'Boolean', description: 'Sets the receive timeout in seconds. Returns true on success.' },
    ],
  },

  // ── ifSocketStatus ───────────────────────────────────────────────────────
  ifSocketStatus: {
    name: 'ifSocketStatus',
    description: 'POSIX errno-based socket error status checkers.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocketstatus.md',
    methods: [
      { name: 'eAgain', signature: 'eAgain() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EAGAIN (resource temporarily unavailable).' },
      { name: 'eAlready', signature: 'eAlready() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EALREADY (operation already in progress).' },
      { name: 'eBadAddr', signature: 'eBadAddr() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EBADADDR (bad address).' },
      { name: 'eDestAddrReq', signature: 'eDestAddrReq() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EDESTADDRREQ (destination address required).' },
      { name: 'eHostUnreach', signature: 'eHostUnreach() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EHOSTUNREACH (no route to host).' },
      { name: 'eInvalid', signature: 'eInvalid() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EINVALID (invalid argument).' },
      { name: 'eInProgress', signature: 'eInProgress() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EINPROGRESS (operation in progress).' },
      { name: 'eWouldBlock', signature: 'eWouldBlock() as Boolean', returnType: 'Boolean', description: 'Returns true if the last error was EWOULDBLOCK (operation would block).' },
      { name: 'eSuccess', signature: 'eSuccess() as Boolean', returnType: 'Boolean', description: 'Returns true if there are no errors (errno is 0).' },
      { name: 'eOK', signature: 'eOK() as Boolean', returnType: 'Boolean', description: 'Returns true if there are no hard errors (async conditions like EAGAIN are OK).' },
    ],
  },

  // ── ifSocketCastOption ───────────────────────────────────────────────────
  ifSocketCastOption: {
    name: 'ifSocketCastOption',
    description: 'UDP multicast and broadcast socket options.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsocketcastoption.md',
    methods: [
      { name: 'GetBroadcast', signature: 'GetBroadcast() as Boolean', returnType: 'Boolean', description: 'Returns true if broadcast messages can be sent or received.' },
      { name: 'SetBroadcast', signature: 'SetBroadcast(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables or disables broadcast. Returns true on success.' },
      { name: 'JoinGroup', signature: 'JoinGroup(ipAddress as Object) as Boolean', returnType: 'Boolean', description: 'Joins a multicast group specified by an roSocketAddress. Returns true on success.' },
      { name: 'DropGroup', signature: 'DropGroup(ipAddress as Object) as Boolean', returnType: 'Boolean', description: 'Leaves a multicast group. Returns true on success.' },
      { name: 'GetMulticastLoop', signature: 'GetMulticastLoop() as Boolean', returnType: 'Boolean', description: 'Returns true if multicast loopback is enabled.' },
      { name: 'SetMulticastLoop', signature: 'SetMulticastLoop(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables or disables local loopback of multicast messages. Returns true on success.' },
      { name: 'GetMulticastTTL', signature: 'GetMulticastTTL() as Integer', returnType: 'Integer', description: 'Returns the TTL (hop limit) for outgoing multicast packets.' },
      { name: 'SetMulticastTTL', signature: 'SetMulticastTTL(ttl as Integer) as Boolean', returnType: 'Boolean', description: 'Sets the TTL for outgoing multicast packets. Returns true on success.' },
    ],
  },

  // ── ifDraw2D ─────────────────────────────────────────────────────────────
  ifDraw2D: {
    name: 'ifDraw2D',
    description: 'Legacy 2D drawing primitives shared by roScreen and roBitmap.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifdraw2d.md',
    methods: [
      { name: 'Clear', signature: 'Clear(rgba as Integer) as Void', returnType: 'Void', description: 'Fills the entire drawable with the given 32-bit RGBA color.' },
      { name: 'GetWidth', signature: 'GetWidth() as Integer', returnType: 'Integer', description: 'Returns the width of the drawable in pixels.' },
      { name: 'GetHeight', signature: 'GetHeight() as Integer', returnType: 'Integer', description: 'Returns the height of the drawable in pixels.' },
      { name: 'GetByteArray', signature: 'GetByteArray(x as Integer, y as Integer, width as Integer, height as Integer) as Object', returnType: 'roByteArray', description: 'Returns a raw ARGB byte array for the specified region.' },
      { name: 'GetPng', signature: 'GetPng(x as Integer, y as Integer, width as Integer, height as Integer) as Object', returnType: 'roByteArray', description: 'Returns a PNG-encoded byte array for the specified region.' },
      { name: 'DrawRect', signature: 'DrawRect(x as Integer, y as Integer, width as Integer, height as Integer, rgba as Integer) as Void', returnType: 'Void', description: 'Fills a rectangle with the given RGBA color.' },
      { name: 'DrawPoint', signature: 'DrawPoint(x as Integer, y as Integer, size as Float, rgba as Integer) as Void', returnType: 'Void', description: 'Draws a single point of the given size and color.' },
      { name: 'DrawLine', signature: 'DrawLine(xStart as Integer, yStart as Integer, xEnd as Integer, yEnd as Integer, rgba as Integer) as Void', returnType: 'Void', description: 'Draws a line between two points in the given color.' },
      { name: 'DrawObject', signature: 'DrawObject(x as Integer, y as Integer, src as Object) as Boolean', returnType: 'Boolean', description: 'Blits src (roBitmap or roRegion) onto this drawable at (x, y). Returns true on success.' },
      { name: 'DrawScaledObject', signature: 'DrawScaledObject(x as Integer, y as Integer, scaleX as Float, scaleY as Float, src as Object) as Boolean', returnType: 'Boolean', description: 'Blits src with horizontal and vertical scaling. Returns true on success.' },
      { name: 'DrawRotatedObject', signature: 'DrawRotatedObject(x as Integer, y as Integer, theta as Float, src as Object) as Boolean', returnType: 'Boolean', description: 'Blits src rotated by theta degrees. Returns true on success.' },
      { name: 'DrawTransformedObject', signature: 'DrawTransformedObject(x as Integer, y as Integer, theta as Float, scaleX as Float, scaleY as Float, src as Object) as Boolean', returnType: 'Boolean', description: 'Blits src with combined rotation and scaling. Returns true on success.' },
      { name: 'DrawText', signature: 'DrawText(text as String, x as Integer, y as Integer, rgba as Integer, font as Object) as Boolean', returnType: 'Boolean', description: 'Renders a text string at (x, y) with the given RGBA color and roFont. Returns true on success.' },
      { name: 'Finish', signature: 'Finish() as Void', returnType: 'Void', description: 'Completes all pending drawing operations. Required before the result is visible.' },
      { name: 'GetAlphaEnable', signature: 'GetAlphaEnable() as Boolean', returnType: 'Boolean', description: 'Returns true if alpha blending is enabled.' },
      { name: 'SetAlphaEnable', signature: 'SetAlphaEnable(enable as Boolean) as Void', returnType: 'Void', description: 'Enables or disables alpha blending for subsequent draw operations.' },
    ],
  },

  // ── ifScreen ─────────────────────────────────────────────────────────────
  ifScreen: {
    name: 'ifScreen',
    description: 'Legacy 2D full-screen surface management for roScreen.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifscreen.md',
    methods: [
      { name: 'SwapBuffers', signature: 'SwapBuffers() as Void', returnType: 'Void', description: 'Completes all drawing and swaps the back buffer to the display.' },
      { name: 'GetGraphicsFeatures', signature: 'GetGraphicsFeatures() as Object', returnType: 'roAssociativeArray', description: 'Returns device graphics capability information (Roku OS 14.0+).', since: '14.0' },
    ],
  },

  // ── ifRegion ─────────────────────────────────────────────────────────────
  ifRegion: {
    name: 'ifRegion',
    description: 'A rectangular sub-region of an roBitmap, used for drawing, sprite frames, and collision detection.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifregion.md',
    methods: [
      { name: 'GetBitmap', signature: 'GetBitmap() as Object', returnType: 'roBitmap', description: 'Returns the parent roBitmap this region refers to.' },
      { name: 'GetX', signature: 'GetX() as Integer', returnType: 'Integer', description: 'Returns the x coordinate of the region within its bitmap.' },
      { name: 'GetY', signature: 'GetY() as Integer', returnType: 'Integer', description: 'Returns the y coordinate of the region within its bitmap.' },
      { name: 'GetWidth', signature: 'GetWidth() as Integer', returnType: 'Integer', description: 'Returns the width of the region in pixels.' },
      { name: 'GetHeight', signature: 'GetHeight() as Integer', returnType: 'Integer', description: 'Returns the height of the region in pixels.' },
      { name: 'Offset', signature: 'Offset(x as Integer, y as Integer, w as Integer, h as Integer) as Void', returnType: 'Void', description: 'Adjusts the region position and dimensions by the given offsets.' },
      { name: 'Set', signature: 'Set(srcRegion as Object) as Void', returnType: 'Void', description: 'Copies all properties from srcRegion into this region.' },
      { name: 'Copy', signature: 'Copy() as Object', returnType: 'roRegion', description: 'Returns a new independent roRegion with the same properties.' },
      { name: 'SetWrap', signature: 'SetWrap(wrap as Boolean) as Void', returnType: 'Void', description: 'Controls whether the region wraps around bitmap boundaries when drawn.' },
      { name: 'GetWrap', signature: 'GetWrap() as Boolean', returnType: 'Boolean', description: 'Returns true if bitmap wrapping is enabled.' },
      { name: 'SetTime', signature: 'SetTime(time as Integer) as Void', returnType: 'Void', description: 'Sets the frame hold time in milliseconds for animated sprites using this region.' },
      { name: 'GetTime', signature: 'GetTime() as Integer', returnType: 'Integer', description: 'Returns the frame hold time in milliseconds.' },
      { name: 'SetPretranslation', signature: 'SetPretranslation(x as Integer, y as Integer) as Void', returnType: 'Void', description: 'Sets an offset applied before drawing operations.' },
      { name: 'GetPretranslationX', signature: 'GetPretranslationX() as Integer', returnType: 'Integer', description: 'Returns the horizontal pre-translation offset.' },
      { name: 'GetPretranslationY', signature: 'GetPretranslationY() as Integer', returnType: 'Integer', description: 'Returns the vertical pre-translation offset.' },
      { name: 'SetScaleMode', signature: 'SetScaleMode(mode as Integer) as Void', returnType: 'Void', description: 'Sets the scaling quality: 0 = fast/nearest-neighbour, 1 = smooth/bilinear.' },
      { name: 'GetScaleMode', signature: 'GetScaleMode() as Integer', returnType: 'Integer', description: 'Returns the current scaling mode.' },
      { name: 'SetCollisionType', signature: 'SetCollisionType(type as Integer) as Void', returnType: 'Void', description: 'Sets the collision shape: 0 = full region, 1 = rectangle, 2 = circle.' },
      { name: 'GetCollisionType', signature: 'GetCollisionType() as Integer', returnType: 'Integer', description: 'Returns the current collision type.' },
      { name: 'SetCollisionRectangle', signature: 'SetCollisionRectangle(xOffset as Integer, yOffset as Integer, width as Integer, height as Integer) as Void', returnType: 'Void', description: 'Defines a rectangular collision bounding box relative to the region origin.' },
      { name: 'SetCollisionCircle', signature: 'SetCollisionCircle(xOffset as Integer, yOffset as Integer, radius as Integer) as Void', returnType: 'Void', description: 'Defines a circular collision area relative to the region origin.' },
    ],
  },

  // ── ifFont ───────────────────────────────────────────────────────────────
  ifFont: {
    name: 'ifFont',
    description: 'Font metrics: line height, text width, ascent, descent.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iffont.md',
    methods: [
      { name: 'GetOneLineHeight', signature: 'GetOneLineHeight() as Integer', returnType: 'Integer', description: 'Returns the pixel distance from one baseline to the next.' },
      { name: 'GetOneLineWidth', signature: 'GetOneLineWidth(text as String, maxWidth as Integer) as Integer', returnType: 'Integer', description: 'Returns the pixel width of text, capped at maxWidth.' },
      { name: 'GetAscent', signature: 'GetAscent() as Integer', returnType: 'Integer', description: 'Returns the font ascent in pixels (distance from baseline to top of tallest glyph).' },
      { name: 'GetDescent', signature: 'GetDescent() as Integer', returnType: 'Integer', description: 'Returns the font descent in pixels (distance from baseline to bottom of deepest glyph).' },
      { name: 'GetMaxAdvance', signature: 'GetMaxAdvance() as Integer', returnType: 'Integer', description: 'Returns the maximum advance width (widest glyph) in pixels.' },
    ],
  },

  // ── ifFontRegistry ───────────────────────────────────────────────────────
  ifFontRegistry: {
    name: 'ifFontRegistry',
    description: 'Loads and retrieves fonts by family, size, weight, and style.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iffontregistry.md',
    methods: [
      { name: 'Register', signature: 'Register(path as String) as Boolean', returnType: 'Boolean', description: 'Registers a TrueType or OpenType font file (.ttf/.otf). Returns true on success.' },
      { name: 'GetFamilies', signature: 'GetFamilies() as Object', returnType: 'roArray', description: 'Returns an roArray of registered font family name strings.' },
      { name: 'GetFont', signature: 'GetFont(family as String, size as Integer, bold as Boolean, italic as Boolean) as Object', returnType: 'roFont', description: 'Returns an roFont from the given family with the specified size and style.' },
      { name: 'GetDefaultFont', signature: 'GetDefaultFont(size as Integer, bold as Boolean, italic as Boolean) as Object', returnType: 'roFont', description: 'Returns the system default font at the given size and style.' },
      { name: 'GetDefaultFontSize', signature: 'GetDefaultFontSize() as Integer', returnType: 'Integer', description: 'Returns the system default font size in pixels.' },
      { name: 'Get', signature: 'Get(family as String, size as Integer, bold as Boolean, italic as Boolean) as String', returnType: 'String', description: 'Returns a font descriptor string for the given family and attributes.' },
    ],
  },

  // ── ifCompositor ─────────────────────────────────────────────────────────
  ifCompositor: {
    name: 'ifCompositor',
    description: 'Sprite compositor that manages drawing and collision detection for a set of sprites.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifcompositor.md',
    methods: [
      { name: 'SetDrawTo', signature: 'SetDrawTo(destBitmap as Object, rgbaBackground as Integer) as Void', returnType: 'Void', description: 'Sets the target drawable (roBitmap or roScreen) and background fill colour.' },
      { name: 'Draw', signature: 'Draw() as Void', returnType: 'Void', description: 'Redraws only sprites that have changed since the last draw.' },
      { name: 'DrawAll', signature: 'DrawAll() as Void', returnType: 'Void', description: 'Forces a full redraw of all sprites and the background.' },
      { name: 'NewSprite', signature: 'NewSprite(x as Integer, y as Integer, region as Object, z as Integer) as Object', returnType: 'roSprite', description: 'Creates a static sprite at (x, y) using region and z-order. Returns the new roSprite.' },
      { name: 'NewAnimatedSprite', signature: 'NewAnimatedSprite(x as Integer, y as Integer, regionArray as Object, z as Integer) as Object', returnType: 'roSprite', description: 'Creates an animated sprite from an roArray of roRegion frames. Returns the new roSprite.' },
      { name: 'AnimationTick', signature: 'AnimationTick(duration as Integer) as Void', returnType: 'Void', description: 'Advances all animated sprites by duration milliseconds.' },
      { name: 'ChangeMatchingRegions', signature: 'ChangeMatchingRegions(oldRegion as Object, newRegion as Object) as Void', returnType: 'Void', description: 'Replaces all uses of oldRegion across managed sprites with newRegion.' },
    ],
  },

  // ── ifSprite ─────────────────────────────────────────────────────────────
  ifSprite: {
    name: 'ifSprite',
    description: 'Sprite position, visibility, z-order, collision, and custom data. Created via roCompositor.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsprite.md',
    methods: [
      { name: 'MoveTo', signature: 'MoveTo(x as Integer, y as Integer) as Void', returnType: 'Void', description: 'Moves the sprite to absolute coordinates (x, y).' },
      { name: 'MoveOffset', signature: 'MoveOffset(xOffset as Integer, yOffset as Integer) as Void', returnType: 'Void', description: 'Moves the sprite by relative offsets.' },
      { name: 'GetX', signature: 'GetX() as Integer', returnType: 'Integer', description: 'Returns the sprite\'s current x coordinate.' },
      { name: 'GetY', signature: 'GetY() as Integer', returnType: 'Integer', description: 'Returns the sprite\'s current y coordinate.' },
      { name: 'SetZ', signature: 'SetZ(z as Integer) as Void', returnType: 'Void', description: 'Sets the z-order for draw ordering (higher z is drawn on top).' },
      { name: 'GetZ', signature: 'GetZ() as Integer', returnType: 'Integer', description: 'Returns the current z-order value.' },
      { name: 'SetDrawableFlag', signature: 'SetDrawableFlag(enable as Boolean) as Void', returnType: 'Void', description: 'Shows or hides the sprite.' },
      { name: 'GetDrawableFlag', signature: 'GetDrawableFlag() as Boolean', returnType: 'Boolean', description: 'Returns true if the sprite is visible.' },
      { name: 'SetMemberFlags', signature: 'SetMemberFlags(flags as Integer) as Void', returnType: 'Void', description: 'Sets the membership bitmask for group collision detection.' },
      { name: 'GetMemberFlags', signature: 'GetMemberFlags() as Integer', returnType: 'Integer', description: 'Returns the membership bitmask.' },
      { name: 'SetCollidableFlags', signature: 'SetCollidableFlags(flags as Integer) as Void', returnType: 'Void', description: 'Sets which member groups this sprite can collide with.' },
      { name: 'GetCollidableFlags', signature: 'GetCollidableFlags() as Integer', returnType: 'Integer', description: 'Returns the collidable group bitmask.' },
      { name: 'SetRegion', signature: 'SetRegion(region as Object) as Void', returnType: 'Void', description: 'Assigns a new roRegion as the sprite\'s visual source.' },
      { name: 'GetRegion', signature: 'GetRegion() as Object', returnType: 'roRegion', description: 'Returns the roRegion currently assigned to this sprite.' },
      { name: 'OffsetRegion', signature: 'OffsetRegion(x as Integer, y as Integer, width as Integer, height as Integer) as Void', returnType: 'Void', description: 'Adjusts the visible portion of the sprite\'s bitmap by the given offsets.' },
      { name: 'SetData', signature: 'SetData(data as Dynamic) as Void', returnType: 'Void', description: 'Attaches arbitrary user data to this sprite.' },
      { name: 'GetData', signature: 'GetData() as Dynamic', returnType: 'Dynamic', description: 'Returns the custom data previously attached with SetData.' },
      { name: 'CheckCollision', signature: 'CheckCollision() as Object', returnType: 'roSprite', description: 'Returns the first roSprite this sprite is colliding with, or invalid if none.' },
      { name: 'CheckMultipleCollisions', signature: 'CheckMultipleCollisions() as Object', returnType: 'roArray', description: 'Returns an roArray of all sprites colliding with this sprite, or invalid.' },
      { name: 'Remove', signature: 'Remove() as Void', returnType: 'Void', description: 'Removes this sprite from its parent roCompositor.' },
    ],
  },

  // ── ifRegex ──────────────────────────────────────────────────────────────
  ifRegex: {
    name: 'ifRegex',
    description: 'Regular expression matching, capturing, replacing, and splitting.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifregex.md',
    methods: [
      { name: 'IsMatch', signature: 'IsMatch(str as String) as Boolean', returnType: 'Boolean', description: 'Returns true if str matches the compiled regular expression.' },
      { name: 'Match', signature: 'Match(str as String) as Object', returnType: 'roArray', description: 'Returns an roArray of captured groups; index 0 is the full match, 1+ are parenthetical captures. Returns empty array if no match.' },
      { name: 'MatchAll', signature: 'MatchAll(str as String) as Object', returnType: 'roArray', description: 'Returns an roArray of all non-overlapping matches, each as an roArray of captures.' },
      { name: 'Replace', signature: 'Replace(str as String, replacement as String) as String', returnType: 'String', description: 'Returns str with the first occurrence replaced. Supports back-references ($1, $2, …).' },
      { name: 'ReplaceAll', signature: 'ReplaceAll(str as String, replacement as String) as String', returnType: 'String', description: 'Returns str with all occurrences replaced. Supports back-references.' },
      { name: 'Split', signature: 'Split(str as String) as Object', returnType: 'roArray', description: 'Splits str around occurrences of the pattern and returns the parts as an roArray.' },
    ],
  },

  // ── ifLocalization ───────────────────────────────────────────────────────
  ifLocalization: {
    name: 'ifLocalization',
    description: 'Channel localisation: locale-specific asset resolution and plural string selection.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iflocalization.md',
    methods: [
      { name: 'GetLocalizedAsset', signature: 'GetLocalizedAsset(dirName as String, fileName as String) as String', returnType: 'String', description: 'Returns the path to the locale-appropriate asset file. Falls back to the default/en_US version if no locale-specific file exists.' },
      { name: 'GetPluralString', signature: 'GetPluralString(count as Integer, zeroString as String, oneString as String, pluralString as String) as String', returnType: 'String', description: 'Returns zeroString when count=0, oneString when count=1, or pluralString otherwise. "^n" in pluralString is replaced with count.' },
    ],
  },

  // ── ifSystemLog ──────────────────────────────────────────────────────────
  ifSystemLog: {
    name: 'ifSystemLog',
    description: 'Subscribes to system-level HTTP and bandwidth log events delivered via message port.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifsystemlog.md',
    methods: [
      { name: 'EnableType', signature: 'EnableType(logType as String) as Void', returnType: 'Void', description: 'Enables delivery of the named log event type. Valid types: "http.connect", "http.error", "http.complete", "bandwidth.minute", "http.headers".' },
    ],
  },

  // ── ifAppManager ─────────────────────────────────────────────────────────
  ifAppManager: {
    name: 'ifAppManager',
    description: 'Channel lifecycle, screensaver settings, voice integration, and now-playing metadata.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifappmanager.md',
    methods: [
      { name: 'GetUptime', signature: 'GetUptime() as Object', returnType: 'roTimespan', description: 'Returns an roTimespan representing milliseconds elapsed since the channel launched.' },
      { name: 'GetScreensaverTimeout', signature: 'GetScreensaverTimeout() as Integer', returnType: 'Integer', description: 'Returns the screensaver activation delay in minutes, or 0 if screensaver is disabled.' },
      { name: 'SetUserSignedIn', signature: 'SetUserSignedIn(signedIn as Boolean) as Void', returnType: 'Void', description: 'Communicates the user\'s authentication state to the Roku OS.' },
      { name: 'SetAutomaticAudioGuideEnabled', signature: 'SetAutomaticAudioGuideEnabled(enabled as Boolean) as Void', returnType: 'Void', description: 'Toggles the automatic screen reader, overriding the manifest setting.' },
      { name: 'IsAppInstalled', signature: 'IsAppInstalled(channelID as String, version as String) as Boolean', returnType: 'Boolean', description: 'Returns true if the specified channel (by ID and minimum version) is installed on the device.' },
      { name: 'SetNowPlayingContentMetaData', signature: 'SetNowPlayingContentMetaData(contentMetaData as Object) as Void', returnType: 'Void', description: 'Updates the now-playing content metadata (title, artwork, etc.) shown by the Roku OS.' },
      { name: 'StartVoiceActionSelectionRequest', signature: 'StartVoiceActionSelectionRequest() as Void', returnType: 'Void', description: 'Triggers a voice profile selection prompt on hands-free Roku Voice remotes.' },
      { name: 'SetVoiceActionStrings', signature: 'SetVoiceActionStrings(actions as Object) as Void', returnType: 'Void', description: 'Registers an roArray of AAs with text strings for matching voice commands.' },
      { name: 'GetLastExitInfo', signature: 'GetLastExitInfo() as Object', returnType: 'roAssociativeArray', description: 'Returns an AA describing the last channel exit: exit code, timestamp, app state, and memory information.' },
    ],
  },

  // ── ifAppMemoryMonitor ───────────────────────────────────────────────────
  ifAppMemoryMonitor: {
    name: 'ifAppMemoryMonitor',
    description: 'Monitors channel memory consumption and receives threshold-based warning events.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifappmemorymonitor.md',
    methods: [
      { name: 'EnableMemoryWarningEvent', signature: 'EnableMemoryWarningEvent(enable as Boolean) as Boolean', returnType: 'Boolean', description: 'Enables roAppMemoryNotificationEvent delivery when memory usage crosses 80%, 85%, 90%, or 95% of the channel limit. Returns true on success.' },
      { name: 'GetMemoryLimitPercent', signature: 'GetMemoryLimitPercent() as Integer', returnType: 'Integer', description: 'Returns current memory usage as a percentage of the channel\'s allocated limit.' },
      { name: 'GetChannelAvailableMemory', signature: 'GetChannelAvailableMemory() as Integer', returnType: 'Integer', description: 'Returns the estimated kilobytes of memory still available to the channel.' },
      { name: 'GetChannelMemoryLimit', signature: 'GetChannelMemoryLimit() as Object', returnType: 'roAssociativeArray', description: 'Returns an AA with maxForegroundMemory, maxBackgroundMemory, and maxRokuManagedHeapMemory (all Integer, in KB).' },
    ],
  },

  // ── ifChannelStore ───────────────────────────────────────────────────────
  ifChannelStore: {
    name: 'ifChannelStore',
    description: 'In-channel purchase API for Roku Pay: catalog, purchase history, and order processing.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifchannelstore.md',
    methods: [
      { name: 'GetIdentity', signature: 'GetIdentity() as Integer', returnType: 'Integer', description: 'Returns a unique request identity handle used to match asynchronous roChannelStoreEvent responses.' },
      { name: 'GetUserData', signature: 'GetUserData() as Void', returnType: 'Void', description: 'Initiates an async request for Roku customer account data. Result arrives as roChannelStoreEvent.' },
      { name: 'GetStoreCatalog', signature: 'GetStoreCatalog() as Void', returnType: 'Void', description: 'Requests the channel\'s in-app product catalog. Result arrives as roChannelStoreEvent.' },
      { name: 'DoOrder', signature: 'DoOrder(order as Object) as Void', returnType: 'Void', description: 'Initiates a purchase transaction. order is an AA with "action" and "code" fields. Result arrives as roChannelStoreEvent.' },
      { name: 'FakeServer', signature: 'FakeServer(enable as Boolean) as Void', returnType: 'Void', description: 'Enables test mode that returns fake successful purchase responses without charging the user.' },
      { name: 'GetPartialUserData', signature: 'GetPartialUserData(fields as String) as Void', returnType: 'Void', description: 'Requests a subset of user account fields. fields is a space-separated list (e.g. "email name").' },
      { name: 'StoreChannelCredData', signature: 'StoreChannelCredData(data as String) as Boolean', returnType: 'Boolean', description: 'Stores an authentication token in the Roku device registry for this channel. Returns true on success.' },
      { name: 'GetCatalog', signature: 'GetCatalog() as Void', returnType: 'Void', description: 'Requests the channel product catalog.' },
      { name: 'GetPurchases', signature: 'GetPurchases() as Void', returnType: 'Void', description: 'Requests the list of user purchases.' },
      { name: 'GetAllPurchases', signature: 'GetAllPurchases() as Void', returnType: 'Void', description: 'Requests all purchases including expired.' },
      { name: 'SetOrder', signature: 'SetOrder(order as Object) as Void', returnType: 'Void', description: 'Sets the current order from a content list.' },
      { name: 'ClearOrder', signature: 'ClearOrder() as Void', returnType: 'Void', description: 'Clears the current order.' },
      { name: 'DeltaOrder', signature: 'DeltaOrder(delta as Object) as Void', returnType: 'Void', description: 'Adds or removes an item from the current order.' },
      { name: 'GetOrder', signature: 'GetOrder() as Object', returnType: 'Object', description: 'Returns the current order items.' },
      { name: 'GetUserRegionData', signature: 'GetUserRegionData() as Void', returnType: 'Void', description: 'Requests region-specific user data.' },
      { name: 'GetChannelCred', signature: 'GetChannelCred() as Void', returnType: 'Void', description: 'Retrieves stored channel credentials.' },
      { name: 'GetDeviceAttestation', signature: 'GetDeviceAttestation() as Void', returnType: 'Void', description: 'Requests a device attestation token.' },
      { name: 'RequestPartnerOrder', signature: 'RequestPartnerOrder(orderInfo as Object) as Void', returnType: 'Void', description: 'Initiates a partner order (TVOD transaction).' },
      { name: 'ConfirmPartnerOrder', signature: 'ConfirmPartnerOrder(confirmInfo as Object) as Void', returnType: 'Void', description: 'Confirms a partner order using the order ID.' },
    ],
  },

  // ── ifDeviceCrypto ───────────────────────────────────────────────────────
  ifDeviceCrypto: {
    name: 'ifDeviceCrypto',
    description: 'Device- and channel-scoped symmetric encryption using device-managed keys.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifdevicecrypto.md',
    methods: [
      { name: 'Encrypt', signature: 'Encrypt(data as Object, encType as String) as Object', returnType: 'roByteArray', description: 'Encrypts data (roByteArray) using the key type "channel", "device", or "model". Returns the encrypted roByteArray.' },
      { name: 'Decrypt', signature: 'Decrypt(data as Object, encType as String) as Object', returnType: 'roByteArray', description: 'Decrypts data (roByteArray) using the corresponding key type. Returns the decrypted roByteArray.' },
    ],
  },

  // ── ifRSA ────────────────────────────────────────────────────────────────
  ifRSA: {
    name: 'ifRSA',
    description: 'RSA digital signature generation and verification.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifrsa.md',
    methods: [
      { name: 'SetPrivateKey', signature: 'SetPrivateKey(privKey as Object) as Integer', returnType: 'Integer', description: 'Sets the RSA private key from a PEM-encoded roByteArray. Returns 0 on success.' },
      { name: 'SetPublicKey', signature: 'SetPublicKey(pubKey as Object) as Integer', returnType: 'Integer', description: 'Sets the RSA public key from a PEM-encoded roByteArray. Returns 0 on success.' },
      { name: 'SetDigestAlgorithm', signature: 'SetDigestAlgorithm(algorithm as String) as Integer', returnType: 'Integer', description: 'Sets the digest algorithm for signing/verification (e.g. "sha1", "sha256"). Returns 0 on success.' },
      { name: 'Sign', signature: 'Sign(data as Object) as Object', returnType: 'roByteArray', description: 'Signs data (roByteArray) with the configured private key and digest algorithm. Returns the signature as an roByteArray.' },
      { name: 'Verify', signature: 'Verify(data as Object, sig as Object) as Integer', returnType: 'Integer', description: 'Verifies the signature against data using the public key. Returns 1 on success, 0 on failure.' },
    ],
  },

  // ── ifRemoteInfo ─────────────────────────────────────────────────────────
  ifRemoteInfo: {
    name: 'ifRemoteInfo',
    description: 'Bluetooth remote control capabilities and wake state.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifremoteinfo.md',
    methods: [
      { name: 'GetModel', signature: 'GetModel(remoteIndex as Integer) as Integer', returnType: 'Integer', description: 'Returns the model number of the remote at remoteIndex (-1 for most recent, 0 for first). Returns 0 if no remote exists at that index.' },
      { name: 'IsAwake', signature: 'IsAwake(remoteIndex as Integer) as Boolean', returnType: 'Boolean', description: 'Returns true if the specified remote is currently awake.' },
      { name: 'HasFeature', signature: 'HasFeature(feature as String, remoteIndex as Integer) as Boolean', returnType: 'Boolean', description: 'Returns true if the remote supports the named feature. Features: "bluetooth", "wifi", "motion", "audio", "voicecapture", "findremote", "hasMuteSwitch".' },
    ],
  },

  // ── ifHdmiStatus ─────────────────────────────────────────────────────────
  ifHdmiStatus: {
    name: 'ifHdmiStatus',
    description: 'HDMI/MHL connection status and HDCP version information.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifhdmistatus.md',
    methods: [
      { name: 'IsConnected', signature: 'IsConnected() as Boolean', returnType: 'Boolean', description: 'Returns true if an HDMI or MHL device is connected to the Roku\'s HDMI output.' },
      { name: 'GetHdcpVersion', signature: 'GetHdcpVersion() as String', returnType: 'String', description: 'Returns the HDCP version in use ("1.4" or "2.2"), or an empty string if HDCP is not active.' },
      { name: 'IsHdcpActive', signature: 'IsHdcpActive(version as String) as Boolean', returnType: 'Boolean', description: 'Returns true if the current HDCP link version matches or exceeds the given version string (e.g. "2.2").' },
    ],
  },

  // ── ifCECStatus ──────────────────────────────────────────────────────────
  ifCECStatus: {
    name: 'ifCECStatus',
    description: 'HDMI-CEC consumer electronics control status.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifcecstatus.md',
    methods: [
      { name: 'IsActiveSource', signature: 'IsActiveSource() as Boolean', returnType: 'Boolean', description: 'Returns true if this device is the current active source on the HDMI-CEC bus.' },
    ],
  },

  // ── ifFunction ───────────────────────────────────────────────────────────
  ifFunction: {
    name: 'ifFunction',
    description: 'Boxed function reference: get and set the underlying function value.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iffunction.md',
    methods: [
      { name: 'GetSub', signature: 'GetSub() as Function', returnType: 'Function', description: 'Returns the underlying BrightScript function (or sub) without changing any variable references.' },
      { name: 'SetSub', signature: 'SetSub(value as Function) as Void', returnType: 'Void', description: 'Replaces the internal function reference, enabling in/out function parameters.' },
    ],
  },

  // ── ifInput ──────────────────────────────────────────────────────────────
  ifInput: {
    name: 'ifInput',
    description: 'External Control Protocol (ECP) and transport-command input receiver.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/ifinput.md',
    methods: [
      { name: 'EnableTransportEvents', signature: 'EnableTransportEvents() as Boolean', returnType: 'Boolean', description: 'Registers the channel to receive roInput transport events for voice commands (play, pause, fast-forward, rewind, etc.). Returns true on success.' },
      { name: 'EventResponse', signature: 'EventResponse(aa as Object) as Boolean', returnType: 'Boolean', description: 'Reports the outcome of a transport command to the OS. aa must include "id" and "status" fields. Must be called within 5 seconds. Returns true on success.' },
      { name: 'GetMessagePort', signature: 'GetMessagePort() as Object', returnType: 'Object', description: 'Returns the message port set for this object.' },
      { name: 'SetMessagePort', signature: 'SetMessagePort(port as Object) as Void', returnType: 'Void', description: 'Sets the roMessagePort that receives events from this object.' },
    ],
  },

  // ── ifTextureManager ─────────────────────────────────────────────────────
  ifTextureManager: {
    name: 'ifTextureManager',
    description: 'Asynchronous bitmap loading and caching manager.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iftexturemanager.md',
    methods: [
      { name: 'RequestTexture', signature: 'RequestTexture(req as Object) as Void', returnType: 'Void', description: 'Queues an roTextureRequest for async download and decoding. Result fires roTextureRequestEvent on the message port.' },
      { name: 'CancelRequest', signature: 'CancelRequest(req as Object) as Void', returnType: 'Void', description: 'Cancels a pending roTextureRequest.' },
      { name: 'UnloadBitmap', signature: 'UnloadBitmap(url as String) as Void', returnType: 'Void', description: 'Removes the cached bitmap for the given URL from memory.' },
      { name: 'Cleanup', signature: 'Cleanup() as Void', returnType: 'Void', description: 'Removes all bitmaps from the texture cache.' },
    ],
  },

  // ── ifTextureRequest ─────────────────────────────────────────────────────
  ifTextureRequest: {
    name: 'ifTextureRequest',
    description: 'Configuration and state for a single roTextureManager bitmap request.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/interfaces/iftexturerequest.md',
    methods: [
      { name: 'GetId', signature: 'GetId() as Integer', returnType: 'Integer', description: 'Returns the unique request ID for matching against roTextureRequestEvent.' },
      { name: 'GetState', signature: 'GetState() as Integer', returnType: 'Integer', description: 'Returns the request state: 0=Requested, 1=Downloading, 2=Downloaded, 3=Ready, 4=Failed, 5=Cancelled.' },
      { name: 'SetAsync', signature: 'SetAsync(async as Boolean) as Void', returnType: 'Void', description: 'Configures async (true, default) or synchronous (false) loading.' },
      { name: 'SetSize', signature: 'SetSize(width as Integer, height as Integer) as Void', returnType: 'Void', description: 'Sets the desired output bitmap dimensions. Native size is used if not set.' },
      { name: 'SetScaleMode', signature: 'SetScaleMode(mode as Integer) as Void', returnType: 'Void', description: 'Sets the scaling mode used when resizing the decoded bitmap.' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Component definitions
// ---------------------------------------------------------------------------

export const BRIGHTSCRIPT_COMPONENTS: BrightScriptComponent[] = [
  {
    name: 'roArray',
    description: 'Dynamic array of any BrightScript values. The `[]` literal creates an roArray.',
    docsUrl: 'https://developer.roku.com/dev/docs/roarray',
    interfaces: ['ifArray', 'ifArrayGet', 'ifArraySet', 'ifArrayJoin', 'ifArraySort', 'ifArraySizeInfo', 'ifArraySlice', 'ifEnum'],
  },
  {
    name: 'roAssociativeArray',
    description: 'Key-value dictionary. The `{}` literal creates an roAssociativeArray.',
    docsUrl: 'https://developer.roku.com/dev/docs/roassociativearray',
    interfaces: ['ifAssociativeArray', 'ifEnum'],
  },
  {
    name: 'roString',
    description: 'Object wrapper for the String primitive. Provides richer string methods than the intrinsic type.',
    docsUrl: 'https://developer.roku.com/dev/docs/rostring',
    interfaces: ['ifString', 'ifStringOps', 'ifToStr'],
  },
  {
    name: 'roInt',
    description: 'Object wrapper for the Integer primitive.',
    docsUrl: 'https://developer.roku.com/dev/docs/roint',
    interfaces: ['ifInt', 'ifToStr'],
  },
  {
    name: 'roFloat',
    description: 'Object wrapper for the Float primitive.',
    docsUrl: 'https://developer.roku.com/dev/docs/rofloat',
    interfaces: ['ifFloat', 'ifToStr'],
  },
  {
    name: 'roDouble',
    description: 'Object wrapper for the Double primitive.',
    docsUrl: 'https://developer.roku.com/dev/docs/rodouble',
    interfaces: ['ifDouble', 'ifToStr'],
  },
  {
    name: 'roBoolean',
    description: 'Object wrapper for the Boolean primitive.',
    docsUrl: 'https://developer.roku.com/dev/docs/roboolean',
    interfaces: ['ifBoolean', 'ifToStr'],
  },
  {
    name: 'roLongInteger',
    description: 'Object wrapper for the LongInteger primitive (64-bit signed).',
    docsUrl: 'https://developer.roku.com/dev/docs/rolonginteger',
    interfaces: ['ifLongInt', 'ifToStr'],
  },
  {
    name: 'roList',
    description: 'Doubly-linked list. More efficient than roArray for frequent head/tail insert and remove.',
    docsUrl: 'https://developer.roku.com/dev/docs/rolist',
    interfaces: ['ifList', 'ifArray', 'ifListToArray', 'ifEnum'],
  },
  {
    name: 'roByteArray',
    description: 'Mutable binary buffer. Used for crypto, file I/O, and encoding operations.',
    docsUrl: 'https://developer.roku.com/dev/docs/robytearray',
    interfaces: ['ifByteArray', 'ifArray', 'ifEnum', 'ifToStr'],
  },
  {
    name: 'roXMLElement',
    description: 'Parses and builds XML. Use Parse() to load XML from a string.',
    docsUrl: 'https://developer.roku.com/dev/docs/roxmlelement',
    interfaces: ['ifXMLElement'],
  },
  {
    name: 'roXMLList',
    description: 'List of roXMLElement objects returned by child-element queries.',
    docsUrl: 'https://developer.roku.com/dev/docs/roxmllist',
    interfaces: ['ifXMLList', 'ifArray', 'ifEnum'],
  },
  {
    name: 'roDateTime',
    description: 'UTC date/time. Supports parsing, formatting, and arithmetic.',
    docsUrl: 'https://developer.roku.com/dev/docs/rodatetime',
    interfaces: ['ifDateTime'],
  },
  {
    name: 'roTimespan',
    description: 'High-resolution timer. Call Mark() to reset, then TotalMilliseconds() to read elapsed time.',
    docsUrl: 'https://developer.roku.com/dev/docs/rotimespan',
    interfaces: ['ifTimespan'],
  },
  {
    name: 'roUrlTransfer',
    description: 'HTTP/HTTPS client. Supports sync and async GET/POST, headers, cookies, and TLS configuration.',
    docsUrl: 'https://developer.roku.com/dev/docs/rourltransfer',
    interfaces: ['ifUrlTransfer', 'ifHttpAgent', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roUrlEvent',
    description: 'Response event delivered via message port when an async roUrlTransfer request completes.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rourlevent.md',
    interfaces: ['ifUrlEvent'],
  },
  {
    name: 'roMessagePort',
    description: 'Event queue. Attach to async objects with SetMessagePort() then call WaitMessage() in your main loop.',
    docsUrl: 'https://developer.roku.com/dev/docs/romessageport',
    interfaces: ['ifMessagePort'],
  },
  {
    name: 'roRenderThreadQueue',
    description: 'Queues messages for render-thread handlers. Enables async communication from Task nodes without blocking via rendezvous.',
    docsUrl: 'https://developer.roku.com/dev/docs/rorenderthreadqueue',
    interfaces: ['ifRenderThreadQueue'],
  },
  {
    name: 'roUtils',
    description: 'Utility functions including deep copy and object identity comparison.',
    docsUrl: 'https://developer.roku.com/dev/docs/routils',
    interfaces: ['ifUtils'],
    since: '15.0',
  },
  {
    name: 'roFileSystem',
    description: 'Filesystem operations: directory listing, copy, move, delete, stat.',
    docsUrl: 'https://developer.roku.com/dev/docs/rofilesystem',
    interfaces: ['ifFileSystem'],
  },
  {
    name: 'roPath',
    description: 'File path manipulation and parsing.',
    docsUrl: 'https://developer.roku.com/dev/docs/ropath',
    interfaces: ['ifPath', 'ifString', 'ifStringOps'],
  },
  {
    name: 'roDeviceInfo',
    description: 'Device model, OS version, network status, display configuration, and advertising ID.',
    docsUrl: 'https://developer.roku.com/dev/docs/rodeviceinfo',
    interfaces: ['ifDeviceInfo', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roAppInfo',
    description: 'Metadata about the currently running channel from its manifest.',
    docsUrl: 'https://developer.roku.com/dev/docs/roappinfo',
    interfaces: ['ifAppInfo'],
  },
  {
    name: 'roRegistry',
    description: 'Persistent channel storage. Data is organised in sections; use roRegistrySection to read/write.',
    docsUrl: 'https://developer.roku.com/dev/docs/roregistry',
    interfaces: ['ifRegistry'],
  },
  {
    name: 'roRegistrySection',
    description: 'One named section in persistent channel storage. Created via CreateObject("roRegistrySection", sectionName).',
    docsUrl: 'https://developer.roku.com/dev/docs/roregistrysection',
    interfaces: ['ifRegistrySection'],
  },
  {
    name: 'roSGNode',
    description: 'A node in the SceneGraph scene tree. Field access via dot notation or GetField()/SetField().',
    docsUrl: 'https://developer.roku.com/dev/docs/rosgnode',
    interfaces: ['ifSGNode'],
  },
  {
    name: 'roSGScreen',
    description: 'Top-level SceneGraph rendering surface. Create the scene with CreateScene() then call Show().',
    docsUrl: 'https://developer.roku.com/dev/docs/rosgscreen',
    interfaces: ['ifSGScreen', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roAudioPlayer',
    description: 'Background audio playback engine with playlist support.',
    docsUrl: 'https://developer.roku.com/dev/docs/roaudioplayer',
    interfaces: ['ifAudioPlayer', 'ifHttpAgent', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roEVPDigest',
    description: 'Compute cryptographic message digests (MD5, SHA-1, SHA-256, SHA-512, etc.).',
    docsUrl: 'https://developer.roku.com/dev/docs/roevpdigest',
    interfaces: ['ifEVPDigest'],
  },
  {
    name: 'roEVPCipher',
    description: 'Symmetric encryption/decryption (AES-128-CBC, AES-256-CBC, etc.).',
    docsUrl: 'https://developer.roku.com/dev/docs/roevpcipher',
    interfaces: ['ifEVPCipher'],
  },
  {
    name: 'roHMAC',
    description: 'HMAC authentication codes using any supported digest algorithm.',
    docsUrl: 'https://developer.roku.com/dev/docs/rohmac',
    interfaces: ['ifHMAC'],
  },
  {
    name: 'roVideoPlayer',
    description: 'Video playback engine with playlist, seeking, audio track selection, and captioning support.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rovideoplayer.md',
    interfaces: ['ifVideoPlayer', 'ifHttpAgent', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roAudioResource',
    description: 'Short audio clip playback for UI sounds and notifications.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roaudioresource.md',
    interfaces: ['ifAudioResource'],
  },
  {
    name: 'roAudioMetadata',
    description: 'Reads metadata tags (ID3, Vorbis, etc.) and cover art from audio files.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roaudiometadata.md',
    interfaces: ['ifAudioMetadata'],
  },
  {
    name: 'roImageMetadata',
    description: 'Reads EXIF and other metadata plus thumbnails from image files.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roimagemetadata.md',
    interfaces: ['ifImageMetadata'],
  },
  {
    name: 'roAudioGuide',
    description: 'Accessibility audio guide: speaks UI element labels for visually impaired users.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roaudioguide.md',
    interfaces: ['ifAudioGuide', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roTextToSpeech',
    description: 'Full text-to-speech engine with language, voice, rate, pitch, and volume control.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rotexttospeech.md',
    interfaces: ['ifTextToSpeech', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roHttpAgent',
    description: 'Shared HTTP agent that manages cookies and headers across multiple roUrlTransfer instances.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rohttpagent.md',
    interfaces: ['ifHttpAgent'],
  },
  {
    name: 'roStreamSocket',
    description: 'TCP stream socket for reliable, ordered, connection-oriented communication.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rostreamsocket.md',
    interfaces: ['ifSocket', 'ifSocketAsync', 'ifSocketConnection', 'ifSocketConnectionOption', 'ifSocketConnectionStatus', 'ifSocketOption', 'ifSocketStatus', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roDataGramSocket',
    description: 'UDP datagram socket for connectionless, best-effort communication and multicast.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rodatagramsocket.md',
    interfaces: ['ifSocket', 'ifSocketAsync', 'ifSocketOption', 'ifSocketStatus', 'ifSocketCastOption', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roSocketAddress',
    description: 'Represents an IP address and port for use with roStreamSocket and roDataGramSocket.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rosocketaddress.md',
    interfaces: ['ifSocketAddress'],
  },
  {
    name: 'roScreen',
    description: 'Low-level 2D drawing surface. Use roBitmap and roCompositor for sprite-based graphics.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roscreen.md',
    interfaces: ['ifScreen', 'ifDraw2D', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roBitmap',
    description: 'Off-screen 2D drawing surface that can be blitted to roScreen or other bitmaps.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/robitmap.md',
    interfaces: ['ifDraw2D'],
  },
  {
    name: 'roRegion',
    description: 'Rectangular sub-region of a bitmap, used as a sprite frame or clip for roCompositor.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roregion.md',
    interfaces: ['ifRegion'],
  },
  {
    name: 'roFont',
    description: 'Loaded font face used for DrawText() calls on roBitmap or roScreen.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rofont.md',
    interfaces: ['ifFont'],
  },
  {
    name: 'roFontRegistry',
    description: 'Registers custom TTF/OTF fonts and vends roFont instances at requested sizes.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rofontregistry.md',
    interfaces: ['ifFontRegistry'],
  },
  {
    name: 'roCompositor',
    description: 'Sprite compositor: manages z-ordered sprites drawn onto a 2D surface.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rocompositor.md',
    interfaces: ['ifCompositor', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roSprite',
    description: 'A single sprite managed by roCompositor; supports collision detection and per-frame regions.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rosprite.md',
    interfaces: ['ifSprite'],
  },
  {
    name: 'roRegex',
    description: 'POSIX regular expression matching, replacement, and splitting for BrightScript strings.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roregex.md',
    interfaces: ['ifRegex'],
  },
  {
    name: 'roLocalization',
    description: 'Localisation helper: resolves locale-specific asset paths and plural string forms.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rolocalization.md',
    interfaces: ['ifLocalization'],
  },
  {
    name: 'roSystemLog',
    description: 'Emits structured log events for bandwidth and DRM monitoring to the message port.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rosystemlog.md',
    interfaces: ['ifSystemLog', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roAppManager',
    description: 'Channel lifecycle and screensaver management; uptime, sign-in state, voice actions.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roappmanager.md',
    interfaces: ['ifAppManager'],
  },
  {
    name: 'roAppMemoryMonitor',
    description: 'Subscribes to system memory-warning events and queries available memory for the channel.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roappmemorymonitor.md',
    interfaces: ['ifAppMemoryMonitor', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roChannelStore',
    description: 'In-channel purchasing: catalog, purchase list, order flow, and credential storage.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rochannelstore.md',
    interfaces: ['ifChannelStore', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roDeviceCrypto',
    description: 'Device-bound encryption/decryption using a hardware-backed key unique to each device.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rodevicecrypto.md',
    interfaces: ['ifDeviceCrypto'],
  },
  {
    name: 'roRSA',
    description: 'RSA asymmetric cryptography: sign and verify data with private/public key pairs.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rorsa.md',
    interfaces: ['ifRSA'],
  },
  {
    name: 'roRemoteInfo',
    description: 'Queries the currently paired Roku remote model, wake state, and feature support.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roremoteinfo.md',
    interfaces: ['ifRemoteInfo'],
  },
  {
    name: 'roHdmiStatus',
    description: 'Reports HDMI connection state, HDCP version, and whether HDCP encryption is active.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rohdmistatus.md',
    interfaces: ['ifHdmiStatus', 'ifSetMessagePort'],
  },
  {
    name: 'roCECStatus',
    description: 'Queries CEC bus status and whether this device is currently the active CEC source.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rocecstatus.md',
    interfaces: ['ifCECStatus', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roFunction',
    description: 'First-class function value. Wraps a BrightScript function reference for callbacks.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rofunction.md',
    interfaces: ['ifFunction', 'ifToStr'],
  },
  {
    name: 'roInput',
    description: 'Receives deep-link and transport-control input events sent to the channel via the ECP.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/roinput.md',
    interfaces: ['ifInput', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roTextureManager',
    description: 'Asynchronous texture loader: request, cancel, and manage GPU-resident bitmaps for SceneGraph.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rotexturemanager.md',
    interfaces: ['ifTextureManager', 'ifHttpAgent', 'ifSetMessagePort', 'ifGetMessagePort'],
  },
  {
    name: 'roTextureRequest',
    description: 'Represents a single texture load request issued to roTextureManager.',
    docsUrl: 'https://developer.roku.com/docs/references/brightscript/components/rotexturerequest.md',
    interfaces: ['ifTextureRequest', 'ifHttpAgent'],
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Map keyed by component name (lowercase) for O(1) lookups. */
const _componentMap = new Map<string, BrightScriptComponent>(
  BRIGHTSCRIPT_COMPONENTS.map((c) => [c.name.toLowerCase(), c])
);

/** Map keyed by interface name (lowercase) for O(1) lookups. */
const _interfaceMap = new Map<string, BrightScriptInterface>(
  Object.entries(BRIGHTSCRIPT_INTERFACES).map(([k, v]) => [k.toLowerCase(), v])
);

export function findComponent(name: string): BrightScriptComponent | undefined {
  return _componentMap.get(name.toLowerCase());
}

export function findInterface(name: string): BrightScriptInterface | undefined {
  return _interfaceMap.get(name.toLowerCase());
}

const _componentMethods = new Map<string, BrightScriptMethod[]>();
const _componentMethodInterfaces = new Map<string, Map<string, BrightScriptInterface>>();

for (const component of BRIGHTSCRIPT_COMPONENTS) {
  const methods: BrightScriptMethod[] = [];
  const methodInterfaces = new Map<string, BrightScriptInterface>();
  const seen = new Set<string>();

  for (const ifName of component.interfaces) {
    const iface = findInterface(ifName);
    if (!iface) continue;

    for (const method of iface.methods) {
      const methodName = method.name.toLowerCase();
      if (!methodInterfaces.has(methodName)) {
        methodInterfaces.set(methodName, iface);
      }
      if (!seen.has(methodName)) {
        seen.add(methodName);
        methods.push(method);
      }
    }
  }

  const componentName = component.name.toLowerCase();
  _componentMethods.set(componentName, methods);
  _componentMethodInterfaces.set(componentName, methodInterfaces);
}

/**
 * Returns the deduplicated list of BrightScriptMethod objects for all
 * interfaces implemented by the named component.
 */
export function getComponentMethods(componentName: string): BrightScriptMethod[] {
  return _componentMethods.get(componentName.toLowerCase()) ?? [];
}

/**
 * Returns the name of the interface that defines methodName on componentName,
 * or undefined if not found.
 */
export function findMethodInterface(componentName: string, methodName: string): BrightScriptInterface | undefined {
  return _componentMethodInterfaces.get(componentName.toLowerCase())?.get(methodName.toLowerCase());
}

/**
 * The date this catalog was last verified against the official Roku docs.
 * Update this constant whenever you synchronise with the live documentation.
 */
/**
 * Date the component/interface catalog was last diffed method-by-method against
 * developer.roku.com. The 2026-07-28 sweep covered 79 of 80 interfaces; only
 * `ifSGNode` is exempt, because Roku has no interface by that name — it is our
 * aggregate of the six real `ifSGNode*` interfaces.
 */
export const CATALOG_LAST_VERIFIED = '2026-07-31';
