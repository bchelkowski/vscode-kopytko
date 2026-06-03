/**
 * BrightScript built-in functions and global objects.
 * Covers the standard BrightScript runtime as documented at:
 * https://developer.roku.com/docs/references/brightscript/language/global-functions.md
 */

export interface BrightScriptBuiltin {
  name: string;
  signature: string;
  returnType: string;
  description: string;
  category: 'math' | 'string' | 'type' | 'utility' | 'io' | 'object';
}

export const BRIGHTSCRIPT_BUILTINS: BrightScriptBuiltin[] = [
  // Math
  { name: 'Abs', signature: 'Abs(x as Float) as Float', returnType: 'Float', description: 'Returns the absolute value of x.', category: 'math' },
  { name: 'Atn', signature: 'Atn(x as Float) as Float', returnType: 'Float', description: 'Returns the arctangent of x in radians.', category: 'math' },
  { name: 'Cos', signature: 'Cos(x as Float) as Float', returnType: 'Float', description: 'Returns the cosine of x (x in radians).', category: 'math' },
  { name: 'Exp', signature: 'Exp(x as Float) as Float', returnType: 'Float', description: 'Returns e^x.', category: 'math' },
  { name: 'Int', signature: 'Int(x as Float) as Integer', returnType: 'Integer', description: 'Returns the floor integer of x.', category: 'math' },
  { name: 'Log', signature: 'Log(x as Float) as Float', returnType: 'Float', description: 'Returns the natural logarithm of x.', category: 'math' },
  { name: 'Rnd', signature: 'Rnd(range as Integer) as Integer', returnType: 'Integer', description: 'Returns a random integer between 1 and range inclusive. Rnd(0) returns a float between 0 and 1.', category: 'math' },
  { name: 'Sgn', signature: 'Sgn(x as Float) as Integer', returnType: 'Integer', description: 'Returns the sign of x: -1, 0, or 1.', category: 'math' },
  { name: 'Sin', signature: 'Sin(x as Float) as Float', returnType: 'Float', description: 'Returns the sine of x (x in radians).', category: 'math' },
  { name: 'Sqr', signature: 'Sqr(x as Float) as Float', returnType: 'Float', description: 'Returns the square root of x.', category: 'math' },
  { name: 'Tan', signature: 'Tan(x as Float) as Float', returnType: 'Float', description: 'Returns the tangent of x (x in radians).', category: 'math' },

  // String
  { name: 'Asc', signature: 'Asc(s as String) as Integer', returnType: 'Integer', description: 'Returns the ASCII code of the first character of s.', category: 'string' },
  { name: 'Chr', signature: 'Chr(ch as Integer) as String', returnType: 'String', description: 'Returns the character corresponding to ASCII code ch.', category: 'string' },
  { name: 'Instr', signature: 'Instr(start as Integer, haystack as String, needle as String) as Integer', returnType: 'Integer', description: 'Returns the position of needle in haystack starting from start (1-based), or 0 if not found.', category: 'string' },
  { name: 'LCase', signature: 'LCase(s as String) as String', returnType: 'String', description: 'Returns s converted to lowercase.', category: 'string' },
  { name: 'Left', signature: 'Left(s as String, n as Integer) as String', returnType: 'String', description: 'Returns the leftmost n characters of s.', category: 'string' },
  { name: 'Len', signature: 'Len(s as String) as Integer', returnType: 'Integer', description: 'Returns the number of characters in s.', category: 'string' },
  { name: 'Mid', signature: 'Mid(s as String, start as Integer, length = -1 as Integer) as String', returnType: 'String', description: 'Returns a substring of s starting at start (1-based) with optional length.', category: 'string' },
  { name: 'Right', signature: 'Right(s as String, n as Integer) as String', returnType: 'String', description: 'Returns the rightmost n characters of s.', category: 'string' },
  { name: 'Str', signature: 'Str(n as Float) as String', returnType: 'String', description: 'Converts a number to its string representation.', category: 'string' },
  { name: 'StrI', signature: 'StrI(n as Integer, base = 10 as Integer) as String', returnType: 'String', description: 'Converts an integer to a string in the given base.', category: 'string' },
  { name: 'String', signature: 'String(n as Integer, ch as String) as String', returnType: 'String', description: 'Returns a string of n repetitions of ch.', category: 'string' },
  { name: 'StringI', signature: 'StringI(n as Integer, ch as Integer) as String', returnType: 'String', description: 'Returns a string of n repetitions of the character with ASCII code ch.', category: 'string' },
  { name: 'Substitute', signature: 'Substitute(template as String, arg0 as String, arg1 = "" as String, arg2 = "" as String, arg3 = "" as String) as String', returnType: 'String', description: 'Substitutes {0}..{3} placeholders in template with the given arguments.', category: 'string' },
  { name: 'UCase', signature: 'UCase(s as String) as String', returnType: 'String', description: 'Returns s converted to uppercase.', category: 'string' },
  { name: 'Val', signature: 'Val(s as String, base = 10 as Integer) as Float', returnType: 'Float', description: 'Parses s as a number in the given base.', category: 'string' },

  // Type conversion
  { name: 'CInt', signature: 'CInt(x as Dynamic) as Integer', returnType: 'Integer', description: 'Converts x to Integer (rounds).', category: 'type' },
  { name: 'CDbl', signature: 'CDbl(x as Dynamic) as Double', returnType: 'Double', description: 'Converts x to Double.', category: 'type' },
  { name: 'CFloat', signature: 'CFloat(x as Dynamic) as Float', returnType: 'Float', description: 'Converts x to Float.', category: 'type' },
  { name: 'CLng', signature: 'CLng(x as Dynamic) as LongInteger', returnType: 'LongInteger', description: 'Converts x to LongInteger.', category: 'type' },
  { name: 'CStr', signature: 'CStr(x as Dynamic) as String', returnType: 'String', description: 'Converts x to String.', category: 'type' },

  // Type inspection
  { name: 'Type', signature: 'Type(obj as Dynamic, version = 3 as Integer) as String', returnType: 'String', description: 'Returns the type name of obj as a string.', category: 'type' },
  { name: 'IsBoolean', signature: 'IsBoolean(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a Boolean.', category: 'type' },
  { name: 'IsDouble', signature: 'IsDouble(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a Double.', category: 'type' },
  { name: 'IsFloat', signature: 'IsFloat(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a Float.', category: 'type' },
  { name: 'IsFunction', signature: 'IsFunction(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a Function reference.', category: 'type' },
  { name: 'IsInt', signature: 'IsInt(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is an Integer.', category: 'type' },
  { name: 'IsInvalid', signature: 'IsInvalid(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is invalid.', category: 'type' },
  { name: 'IsLongInteger', signature: 'IsLongInteger(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a LongInteger.', category: 'type' },
  { name: 'IsObject', signature: 'IsObject(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is an object (roAssociativeArray, roArray, etc).', category: 'type' },
  { name: 'IsString', signature: 'IsString(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a String.', category: 'type' },
  { name: 'IsDefined', signature: 'IsDefined(name as String) as Boolean', returnType: 'Boolean', description: 'Returns true if a variable with the given name is defined in scope.', category: 'type' },

  // Utility
  { name: 'CreateObject', signature: 'CreateObject(objectName as String, ...args) as Dynamic', returnType: 'Dynamic', description: 'Creates a BrightScript object of the given type.', category: 'utility' },
  { name: 'GetGlobalAA', signature: 'GetGlobalAA() as Object', returnType: 'Object', description: 'Returns the global associative array (m in main thread scope).', category: 'utility' },
  { name: 'Sleep', signature: 'Sleep(milliseconds as Integer)', returnType: 'Void', description: 'Pauses execution for the given number of milliseconds.', category: 'utility' },
  { name: 'Wait', signature: 'Wait(timeout as Integer, port as Object) as Object', returnType: 'Object', description: 'Waits up to timeout ms for a message on port.', category: 'utility' },
  { name: 'UpTime', signature: 'UpTime(dummy as Integer) as Float', returnType: 'Float', description: 'Returns the number of seconds since the system last rebooted.', category: 'utility' },
  { name: 'RebootSystem', signature: 'RebootSystem()', returnType: 'Void', description: 'Reboots the Roku device.', category: 'utility' },
  { name: 'RunGarbageCollector', signature: 'RunGarbageCollector() as Object', returnType: 'Object', description: 'Runs the BrightScript garbage collector and returns statistics.', category: 'utility' },

  // JSON / XML
  { name: 'FormatJson', signature: 'FormatJson(obj as Object, flags = 0 as Integer) as String', returnType: 'String', description: 'Serializes obj to a JSON string.', category: 'utility' },
  { name: 'ParseJson', signature: 'ParseJson(json as String) as Dynamic', returnType: 'Dynamic', description: 'Parses a JSON string into a BrightScript object.', category: 'utility' },
  { name: 'ParseXML', signature: 'ParseXML(xml as String) as Object', returnType: 'Object', description: 'Parses an XML string and returns an roXMLElement.', category: 'utility' },

  // IO
  { name: 'WriteAsciiFile', signature: 'WriteAsciiFile(filePath as String, text as String) as Boolean', returnType: 'Boolean', description: 'Writes text to a file at filePath. Returns true on success.', category: 'io' },
  { name: 'ReadAsciiFile', signature: 'ReadAsciiFile(filePath as String) as String', returnType: 'String', description: 'Reads the content of a text file and returns it as a string.', category: 'io' },
];

/**
 * Build a lookup map for O(1) access by name (case-insensitive).
 */
const _builtinMap = new Map<string, BrightScriptBuiltin>(
  BRIGHTSCRIPT_BUILTINS.map((b) => [b.name.toLowerCase(), b])
);

export function findBuiltin(name: string): BrightScriptBuiltin | undefined {
  return _builtinMap.get(name.toLowerCase());
}

export const BRIGHTSCRIPT_KEYWORDS = [
  'and', 'as', 'boolean', 'box', 'catch', 'createobject', 'dim', 'double',
  'dynamic', 'each', 'else', 'elseif', 'end', 'endif', 'endsub', 'endfor',
  'endfunction', 'endtry', 'endwhile', 'exit', 'exitwhile', 'exitfor', 'false',
  'float', 'for', 'function', 'goto', 'if', 'in', 'integer', 'invalid', 'let',
  'longinteger', 'mod', 'next', 'not', 'object', 'or', 'return', 'step', 'stop',
  'string', 'sub', 'then', 'throw', 'to', 'true', 'try', 'type', 'void', 'while',
];
