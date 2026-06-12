/**
 * BrightScript built-in functions and global objects.
 * Covers the standard BrightScript runtime as documented at:
 * https://developer.roku.com/dev/docs/global-math-functions
 * https://developer.roku.com/dev/docs/global-string-functions
 * https://developer.roku.com/dev/docs/global-utility-functions
 * https://developer.roku.com/dev/docs/runtime-functions
 */

interface BrightScriptBuiltin {
  name: string;
  signature: string;
  returnType: string;
  description: string;
  /** URL of the official Roku documentation page for this function */
  docsUrl: string;
  category: 'math' | 'string' | 'type' | 'utility' | 'io' | 'filesystem';
}

const MATH_DOCS = 'https://developer.roku.com/dev/docs/global-math-functions';
const STRING_DOCS = 'https://developer.roku.com/dev/docs/global-string-functions';
const UTILITY_DOCS = 'https://developer.roku.com/dev/docs/global-utility-functions';
const RUNTIME_DOCS = 'https://developer.roku.com/dev/docs/runtime-functions';

export const BRIGHTSCRIPT_BUILTINS: BrightScriptBuiltin[] = [
  // Math
  { name: 'Abs', signature: 'Abs(x as Float) as Float', returnType: 'Float', description: 'Returns the absolute value of x.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Atn', signature: 'Atn(x as Float) as Float', returnType: 'Float', description: 'Returns the arctangent of x in radians.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'CInt', signature: 'CInt(x as Dynamic) as Integer', returnType: 'Integer', description: 'Converts x to Integer (rounds to nearest).', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Cdbl', signature: 'Cdbl(x as Dynamic) as Double', returnType: 'Double', description: 'Returns a double-precision float representation of the argument.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Cos', signature: 'Cos(x as Float) as Float', returnType: 'Float', description: 'Returns the cosine of x (x in radians).', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Csng', signature: 'Csng(x as Dynamic) as Float', returnType: 'Float', description: 'Returns a single-precision float representation of the argument.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Exp', signature: 'Exp(x as Float) as Float', returnType: 'Float', description: 'Returns e^x.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Fix', signature: 'Fix(x as Float) as Integer', returnType: 'Integer', description: 'Truncates x toward zero (removes the fractional part). Unlike Int(), which floors toward negative infinity, Fix(-2.9) returns -2.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Int', signature: 'Int(x as Float) as Integer', returnType: 'Integer', description: 'Returns the largest integer less than or equal to x (floor). Int(-2.1) returns -3. Use Fix() to truncate toward zero instead.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Log', signature: 'Log(x as Float) as Float', returnType: 'Float', description: 'Returns the natural logarithm of x.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Rnd', signature: 'Rnd(range as Integer) as Integer', returnType: 'Integer', description: 'Returns a random integer between 1 and range inclusive. Rnd(0) returns a float between 0 and 1.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Sgn', signature: 'Sgn(x as Float) as Integer', returnType: 'Integer', description: 'Returns the sign of x: -1, 0, or 1.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Sin', signature: 'Sin(x as Float) as Float', returnType: 'Float', description: 'Returns the sine of x (x in radians).', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Sqr', signature: 'Sqr(x as Float) as Float', returnType: 'Float', description: 'Returns the square root of x.', docsUrl: MATH_DOCS, category: 'math' },
  { name: 'Tan', signature: 'Tan(x as Float) as Float', returnType: 'Float', description: 'Returns the tangent of x (x in radians).', docsUrl: MATH_DOCS, category: 'math' },

  // String
  { name: 'Asc', signature: 'Asc(s as String) as Integer', returnType: 'Integer', description: 'Returns the ASCII code of the first character of s.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Chr', signature: 'Chr(ch as Integer) as String', returnType: 'String', description: 'Returns the character corresponding to ASCII code ch.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Instr', signature: 'Instr(start as Integer, haystack as String, needle as String) as Integer', returnType: 'Integer', description: 'Returns the position of needle in haystack starting from start (1-based), or 0 if not found.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'LCase', signature: 'LCase(s as String) as String', returnType: 'String', description: 'Returns s converted to lowercase.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Left', signature: 'Left(s as String, n as Integer) as String', returnType: 'String', description: 'Returns the leftmost n characters of s.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Len', signature: 'Len(s as String) as Integer', returnType: 'Integer', description: 'Returns the number of characters in s.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Mid', signature: 'Mid(s as String, start as Integer, length = -1 as Integer) as String', returnType: 'String', description: 'Returns a substring of s starting at start (1-based) with optional length.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Right', signature: 'Right(s as String, n as Integer) as String', returnType: 'String', description: 'Returns the rightmost n characters of s.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Str', signature: 'Str(n as Float) as String', returnType: 'String', description: 'Converts a number to its string representation.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'StrI', signature: 'StrI(n as Integer, base = 10 as Integer) as String', returnType: 'String', description: 'Converts an integer to a string in the given base.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'String', signature: 'String(n as Integer, ch as String) as String', returnType: 'String', description: 'Returns a string of n repetitions of ch.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'StringI', signature: 'StringI(n as Integer, ch as Integer) as String', returnType: 'String', description: 'Returns a string of n repetitions of the character with ASCII code ch.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Substitute', signature: 'Substitute(template as String, arg0 as String, arg1 = "" as String, arg2 = "" as String, arg3 = "" as String) as String', returnType: 'String', description: 'Substitutes {0}..{3} placeholders in template with the given arguments.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Tr', signature: 'Tr(str as String) as String', returnType: 'String', description: 'Returns the localized translation of str from the channel\'s locale package. Returns str unchanged if no translation is found.', docsUrl: UTILITY_DOCS, category: 'string' },
  { name: 'UCase', signature: 'UCase(s as String) as String', returnType: 'String', description: 'Returns s converted to uppercase.', docsUrl: STRING_DOCS, category: 'string' },
  { name: 'Val', signature: 'Val(s as String, base = 10 as Integer) as Float', returnType: 'Float', description: 'Parses s as a number in the given base.', docsUrl: STRING_DOCS, category: 'string' },

  // Type
  { name: 'Box', signature: 'Box(x as Dynamic) as Dynamic', returnType: 'Dynamic', description: 'Boxes a primitive value into its corresponding object type (e.g. Integer → roInt, Float → roFloat, String → roString). Returns objects unchanged.', docsUrl: RUNTIME_DOCS, category: 'type' },
  { name: 'GetInterface', signature: 'GetInterface(obj as Dynamic, ifName as String) as Dynamic', returnType: 'Dynamic', description: 'Returns the named interface of obj, or invalid if obj does not implement it. Used to check interface support at runtime.', docsUrl: UTILITY_DOCS, category: 'type' },
  { name: 'Type', signature: 'Type(obj as Dynamic, version = 3 as Integer) as String', returnType: 'String', description: 'Returns the type name of obj as a string (e.g. "roArray", "Integer", "String", "invalid").', docsUrl: RUNTIME_DOCS, category: 'type' },

  // Utility
  { name: 'CreateObject', signature: 'CreateObject(objectName as String, ...args) as Dynamic', returnType: 'Dynamic', description: 'Creates a BrightScript object of the given type. Returns invalid if the object name is unknown.', docsUrl: RUNTIME_DOCS, category: 'utility' },
  { name: 'Eval', signature: 'Eval(code as String) as Dynamic', returnType: 'Dynamic', description: 'Deprecated. Dynamically compiles and executes the BrightScript code string at runtime. Avoid in new code — use normal function calls instead.', docsUrl: RUNTIME_DOCS, category: 'utility' },
  { name: 'FindMemberFunction', signature: 'FindMemberFunction(obj as Dynamic, funcName as String) as Dynamic', returnType: 'Dynamic', description: 'Returns a function reference for the named member function on obj, or invalid if not found. Useful for dynamic dispatch.', docsUrl: UTILITY_DOCS, category: 'utility' },
  { name: 'FormatDrive', signature: 'FormatDrive(drive as String, fs_type as String) as Boolean', returnType: 'Boolean', description: 'Formats the storage volume at drive with the given filesystem type (e.g. "fat32"). Returns true on success.', docsUrl: UTILITY_DOCS, category: 'utility' },
  { name: 'GetGlobalAA', signature: 'GetGlobalAA() as Object', returnType: 'Object', description: 'Returns the global associative array shared across all BrightScript code in the main thread.', docsUrl: RUNTIME_DOCS, category: 'utility' },
  { name: 'GetLastRunCompileError', signature: 'GetLastRunCompileError() as Object', returnType: 'Object', description: 'Returns an roAssociativeArray describing the last compile-time error, or invalid if no error occurred. Keys: number, message, file, lineNumber.', docsUrl: RUNTIME_DOCS, category: 'utility' },
  { name: 'GetLastRunRuntimeError', signature: 'GetLastRunRuntimeError() as Integer', returnType: 'Integer', description: 'Returns the error code from the last Run() call. Returns 0 if no error occurred. Only meaningful after Run() — for general runtime exceptions use try/catch.', docsUrl: RUNTIME_DOCS, category: 'utility' },
  { name: 'RebootSystem', signature: 'RebootSystem()', returnType: 'Void', description: 'Reboots the Roku device.', docsUrl: UTILITY_DOCS, category: 'utility' },
  { name: 'Run', signature: 'Run(filename as String, ...args) as Dynamic', returnType: 'Dynamic', description: 'Deprecated. Compiles and executes a BrightScript source file at runtime. Returns the value passed to End or Stop. Avoid in new code.', docsUrl: RUNTIME_DOCS, category: 'utility' },
  { name: 'RunGarbageCollector', signature: 'RunGarbageCollector() as Object', returnType: 'Object', description: 'Runs the BrightScript garbage collector and returns an roAssociativeArray with collection statistics.', docsUrl: UTILITY_DOCS, category: 'utility' },
  { name: 'Sleep', signature: 'Sleep(milliseconds as Integer)', returnType: 'Void', description: 'Pauses execution for the given number of milliseconds.', docsUrl: UTILITY_DOCS, category: 'utility' },
  { name: 'StrToI', signature: 'StrToI(str as String) as Dynamic', returnType: 'Dynamic', description: 'Converts the string str to an integer. Returns 0 if the string cannot be parsed. Unlike Val(), which returns a Float, StrToI() returns an Integer (or invalid on failure).', docsUrl: UTILITY_DOCS, category: 'utility' },
  { name: 'UpTime', signature: 'UpTime(dummy as Integer) as Float', returnType: 'Float', description: 'Returns the number of seconds since the system last rebooted. The argument is ignored; pass 0.', docsUrl: UTILITY_DOCS, category: 'utility' },
  { name: 'Wait', signature: 'Wait(timeout as Integer, port as Object) as Object', returnType: 'Object', description: 'Waits up to timeout ms for a message on port. Returns the message object, or invalid on timeout. Pass 0 to wait indefinitely.', docsUrl: UTILITY_DOCS, category: 'utility' },

  // JSON
  { name: 'FormatJson', signature: 'FormatJson(obj as Object, flags = 0 as Integer) as String', returnType: 'String', description: 'Serializes obj to a JSON string.', docsUrl: UTILITY_DOCS, category: 'utility' },
  { name: 'ParseJson', signature: 'ParseJson(json as String, flags = "" as String) as Dynamic', returnType: 'Dynamic', description: 'Parses a JSON string into a BrightScript object. Optional flags: "i" for case-insensitive keys, "d" for double-precision numbers.', docsUrl: UTILITY_DOCS, category: 'utility' },

  // IO
  { name: 'ReadAsciiFile', signature: 'ReadAsciiFile(filePath as String) as String', returnType: 'String', description: 'Reads the content of a text file and returns it as a string.', docsUrl: UTILITY_DOCS, category: 'io' },
  { name: 'WriteAsciiFile', signature: 'WriteAsciiFile(filePath as String, text as String) as Boolean', returnType: 'Boolean', description: 'Writes text to a file at filePath. Returns true on success.', docsUrl: UTILITY_DOCS, category: 'io' },

  // Filesystem
  { name: 'CopyFile', signature: 'CopyFile(source as String, destination as String) as Boolean', returnType: 'Boolean', description: 'Copies the file at source to destination. Returns true on success.', docsUrl: UTILITY_DOCS, category: 'filesystem' },
  { name: 'CreateDirectory', signature: 'CreateDirectory(path as String) as Boolean', returnType: 'Boolean', description: 'Creates a new directory at path. Returns true on success. Does not create intermediate directories.', docsUrl: UTILITY_DOCS, category: 'filesystem' },
  { name: 'DeleteDirectory', signature: 'DeleteDirectory(path as String) as Boolean', returnType: 'Boolean', description: 'Deletes the directory at path. The directory must be empty. Returns true on success.', docsUrl: UTILITY_DOCS, category: 'filesystem' },
  { name: 'DeleteFile', signature: 'DeleteFile(path as String) as Boolean', returnType: 'Boolean', description: 'Deletes the file at path. Returns true on success.', docsUrl: UTILITY_DOCS, category: 'filesystem' },
  { name: 'ListDir', signature: 'ListDir(path as String) as Object', returnType: 'Object', description: 'Returns an roArray of strings containing the names (not full paths) of all files and directories in path.', docsUrl: UTILITY_DOCS, category: 'filesystem' },
  { name: 'MatchFiles', signature: 'MatchFiles(path as String, pattern as String) as Object', returnType: 'Object', description: 'Returns an roArray of filenames in path whose names match the shell-style glob pattern. Matches only filenames, not subdirectory contents.', docsUrl: UTILITY_DOCS, category: 'filesystem' },
  { name: 'MoveFile', signature: 'MoveFile(source as String, destination as String) as Boolean', returnType: 'Boolean', description: 'Moves (renames) the file at source to destination. Returns true on success.', docsUrl: UTILITY_DOCS, category: 'filesystem' },
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
  'and', 'as', 'boolean', 'catch', 'dim', 'double',
  'dynamic', 'each', 'else', 'elseif', 'end', 'endif', 'endsub', 'endfor',
  'endfunction', 'endtry', 'endwhile', 'exit', 'exitwhile', 'exitfor', 'false',
  'float', 'for', 'function', 'goto', 'if', 'in', 'integer', 'invalid', 'let',
  'interface', 'line_num', 'longinteger', 'mod', 'next', 'not', 'object', 'or', 'print',
  'rem', 'return', 'step', 'stop', 'string', 'sub', 'tab', 'then', 'throw',
  'to', 'true', 'try', 'void', 'while',
];

