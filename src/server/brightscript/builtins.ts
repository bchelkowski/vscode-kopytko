/**
 * BrightScript built-in functions and global objects.
 * Covers the standard BrightScript runtime as documented at:
 * https://developer.roku.com/docs/references/brightscript/language/global-functions.md
 */

interface BrightScriptBuiltin {
  name: string;
  signature: string;
  returnType: string;
  description: string;
  category: 'math' | 'string' | 'type' | 'utility' | 'io' | 'filesystem' | 'object';
}

export const BRIGHTSCRIPT_BUILTINS: BrightScriptBuiltin[] = [
  // Math
  { name: 'Abs', signature: 'Abs(x as Float) as Float', returnType: 'Float', description: 'Returns the absolute value of x.', category: 'math' },
  { name: 'Atn', signature: 'Atn(x as Float) as Float', returnType: 'Float', description: 'Returns the arctangent of x in radians.', category: 'math' },
  { name: 'Cos', signature: 'Cos(x as Float) as Float', returnType: 'Float', description: 'Returns the cosine of x (x in radians).', category: 'math' },
  { name: 'Exp', signature: 'Exp(x as Float) as Float', returnType: 'Float', description: 'Returns e^x.', category: 'math' },
  { name: 'Fix', signature: 'Fix(x as Float) as Integer', returnType: 'Integer', description: 'Truncates x toward zero (removes the fractional part). Unlike Int(), which floors toward negative infinity, Fix(-2.9) returns -2.', category: 'math' },
  { name: 'Int', signature: 'Int(x as Float) as Integer', returnType: 'Integer', description: 'Returns the largest integer less than or equal to x (floor). Int(-2.1) returns -3. Use Fix() to truncate toward zero instead.', category: 'math' },
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
  { name: 'InstrRev', signature: 'InstrRev(haystack as String, needle as String) as Integer', returnType: 'Integer', description: 'Returns the position of the last occurrence of needle in haystack (1-based), or 0 if not found. Use Instr() to find the first occurrence.', category: 'string' },
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
  { name: 'Tr', signature: 'Tr(str as String) as String', returnType: 'String', description: 'Returns the localized translation of str from the channel\'s locale package. Returns str unchanged if no translation is found.', category: 'string' },
  { name: 'UCase', signature: 'UCase(s as String) as String', returnType: 'String', description: 'Returns s converted to uppercase.', category: 'string' },
  { name: 'Val', signature: 'Val(s as String, base = 10 as Integer) as Float', returnType: 'Float', description: 'Parses s as a number in the given base.', category: 'string' },

  // Type conversion
  { name: 'Box', signature: 'Box(x as Dynamic) as Dynamic', returnType: 'Dynamic', description: 'Boxes a primitive value into its corresponding object type (e.g. Integer → roInt, Float → roFloat, String → roString). Returns objects unchanged.', category: 'type' },
  { name: 'CBool', signature: 'CBool(x as Dynamic) as Boolean', returnType: 'Boolean', description: 'Converts x to Boolean. Non-zero numbers and non-empty strings become true; zero, empty string, and invalid become false.', category: 'type' },
  { name: 'CDbl', signature: 'CDbl(x as Dynamic) as Double', returnType: 'Double', description: 'Converts x to Double.', category: 'type' },
  { name: 'CFloat', signature: 'CFloat(x as Dynamic) as Float', returnType: 'Float', description: 'Converts x to Float (same as Csng).', category: 'type' },
  { name: 'CInt', signature: 'CInt(x as Dynamic) as Integer', returnType: 'Integer', description: 'Converts x to Integer (rounds to nearest).', category: 'type' },
  { name: 'CLng', signature: 'CLng(x as Dynamic) as LongInteger', returnType: 'LongInteger', description: 'Converts x to LongInteger.', category: 'type' },
  { name: 'Csng', signature: 'Csng(x as Dynamic) as Float', returnType: 'Float', description: 'Converts x to single-precision Float. Equivalent to CFloat().', category: 'type' },
  { name: 'CObj', signature: 'CObj(x as Dynamic) as Object', returnType: 'Object', description: 'Casts x to Object type. Used to pass a value as a generic Object reference.', category: 'type' },
  { name: 'CStr', signature: 'CStr(x as Dynamic) as String', returnType: 'String', description: 'Converts x to String.', category: 'type' },
  { name: 'Unbox', signature: 'Unbox(x as Dynamic) as Dynamic', returnType: 'Dynamic', description: 'Extracts the primitive value from a boxed object (e.g. roInt → Integer, roFloat → Float, roString → String). Returns non-object values unchanged. Inverse of Box().', category: 'type' },

  // Type inspection
  { name: 'GetInterface', signature: 'GetInterface(obj as Dynamic, ifName as String) as Dynamic', returnType: 'Dynamic', description: 'Returns the named interface of obj, or invalid if obj does not implement it. Used to check interface support at runtime.', category: 'type' },
  { name: 'IsArray', signature: 'IsArray(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is an roArray.', category: 'type' },
  { name: 'IsAssociativeArray', signature: 'IsAssociativeArray(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is an roAssociativeArray.', category: 'type' },
  { name: 'IsBoolean', signature: 'IsBoolean(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a Boolean.', category: 'type' },
  { name: 'IsDefined', signature: 'IsDefined(name as String) as Boolean', returnType: 'Boolean', description: 'Returns true if a variable with the given name is defined in the current scope.', category: 'type' },
  { name: 'IsDouble', signature: 'IsDouble(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a Double.', category: 'type' },
  { name: 'IsFloat', signature: 'IsFloat(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a Float.', category: 'type' },
  { name: 'IsFunction', signature: 'IsFunction(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a Function reference.', category: 'type' },
  { name: 'IsInt', signature: 'IsInt(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is an Integer.', category: 'type' },
  { name: 'IsInvalid', signature: 'IsInvalid(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is invalid.', category: 'type' },
  { name: 'IsLongInteger', signature: 'IsLongInteger(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a LongInteger.', category: 'type' },
  { name: 'IsList', signature: 'IsList(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is an roList.', category: 'type' },
  { name: 'IsNaN', signature: 'IsNaN(x as Float) as Boolean', returnType: 'Boolean', description: 'Returns true if x is NaN (not-a-number), e.g. from 0/0 or Sqr of a negative number.', category: 'type' },
  { name: 'IsNode', signature: 'IsNode(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is an roSGNode (SceneGraph node).', category: 'type' },
  { name: 'IsObject', signature: 'IsObject(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a BrightScript object (roAssociativeArray, roArray, roSGNode, etc).', category: 'type' },
  { name: 'IsString', signature: 'IsString(obj as Dynamic) as Boolean', returnType: 'Boolean', description: 'Returns true if obj is a String.', category: 'type' },
  { name: 'Type', signature: 'Type(obj as Dynamic, version = 3 as Integer) as String', returnType: 'String', description: 'Returns the type name of obj as a string (e.g. "roArray", "Integer", "String", "invalid").', category: 'type' },

  // Utility
  { name: 'CreateObject', signature: 'CreateObject(objectName as String, ...args) as Dynamic', returnType: 'Dynamic', description: 'Creates a BrightScript object of the given type. Returns invalid if the object name is unknown.', category: 'utility' },
  { name: 'Eval', signature: 'Eval(code as String) as Dynamic', returnType: 'Dynamic', description: 'Deprecated. Dynamically compiles and executes the BrightScript code string at runtime. Avoid in new code — use normal function calls instead.', category: 'utility' },
  { name: 'FindMemberFunction', signature: 'FindMemberFunction(obj as Dynamic, funcName as String) as Dynamic', returnType: 'Dynamic', description: 'Returns a function reference for the named member function on obj, or invalid if not found. Useful for dynamic dispatch.', category: 'utility' },
  { name: 'GetGlobalAA', signature: 'GetGlobalAA() as Object', returnType: 'Object', description: 'Returns the global associative array shared across all BrightScript code in the main thread.', category: 'utility' },
  { name: 'GetLastRunCompileError', signature: 'GetLastRunCompileError() as Object', returnType: 'Object', description: 'Returns an roAssociativeArray describing the last compile-time error, or invalid if no error occurred. Keys: number, message, file, lineNumber.', category: 'utility' },
  { name: 'GetLastRunRuntimeError', signature: 'GetLastRunRuntimeError() as Integer', returnType: 'Integer', description: 'Returns the error code from the last Run() call. Returns 0 if no error occurred. Only meaningful after Run() — for general runtime exceptions use try/catch.', category: 'utility' },
  { name: 'ObjFun', signature: 'ObjFun(obj as Dynamic, funcName as String, ...args) as Dynamic', returnType: 'Dynamic', description: 'Calls the named member function on obj with the provided arguments. Equivalent to obj.funcName(...args) but with a dynamic function name.', category: 'utility' },
  { name: 'FormatDrive', signature: 'FormatDrive(drive as String, fs_type as String) as Boolean', returnType: 'Boolean', description: 'Formats the storage volume at drive with the given filesystem type (e.g. "fat32"). Returns true on success.', category: 'utility' },
  { name: 'Pos', signature: 'Pos(dummy as Integer) as Integer', returnType: 'Integer', description: 'Returns the current column position of the print cursor on the current output line. The argument is ignored; pass 0.', category: 'utility' },
  { name: 'Mktime', signature: 'Mktime(time as Object) as LongInteger', returnType: 'LongInteger', description: 'Converts a date/time associative array to a Unix epoch (seconds since 1970-01-01 UTC). The AA must contain integer fields: year, month, day, hour, minute, second.', category: 'utility' },
  { name: 'RebootSystem', signature: 'RebootSystem()', returnType: 'Void', description: 'Reboots the Roku device.', category: 'utility' },
  { name: 'Run', signature: 'Run(filename as String, ...args) as Dynamic', returnType: 'Dynamic', description: 'Deprecated. Compiles and executes a BrightScript source file at runtime. Returns the value passed to End or Stop. Avoid in new code.', category: 'utility' },
  { name: 'RunGarbageCollector', signature: 'RunGarbageCollector() as Object', returnType: 'Object', description: 'Runs the BrightScript garbage collector and returns an roAssociativeArray with collection statistics.', category: 'utility' },
  { name: 'StrToI', signature: 'StrToI(str as String) as Dynamic', returnType: 'Dynamic', description: 'Converts the string str to an integer. Returns 0 if the string cannot be parsed. Unlike Val(), which returns a Float, StrToI() returns an Integer (or invalid on failure).', category: 'utility' },
  { name: 'Tab', signature: 'Tab(col as Integer) as String', returnType: 'String', description: 'Used in print statements to advance output to column col. If the cursor is already past col, moves to col on the next line. Only meaningful inside a print statement.', category: 'utility' },
  { name: 'Sleep', signature: 'Sleep(milliseconds as Integer)', returnType: 'Void', description: 'Pauses execution for the given number of milliseconds.', category: 'utility' },
  { name: 'UpTime', signature: 'UpTime(dummy as Integer) as Float', returnType: 'Float', description: 'Returns the number of seconds since the system last rebooted. The argument is ignored; pass 0.', category: 'utility' },
  { name: 'Wait', signature: 'Wait(timeout as Integer, port as Object) as Object', returnType: 'Object', description: 'Waits up to timeout ms for a message on port. Returns the message object, or invalid on timeout. Pass 0 to wait indefinitely.', category: 'utility' },

  // JSON / XML
  { name: 'FormatJson', signature: 'FormatJson(obj as Object, flags = 0 as Integer) as String', returnType: 'String', description: 'Serializes obj to a JSON string.', category: 'utility' },
  { name: 'ParseJson', signature: 'ParseJson(json as String, flags = "" as String) as Dynamic', returnType: 'Dynamic', description: 'Parses a JSON string into a BrightScript object. Optional flags: "i" for case-insensitive keys, "d" for double-precision numbers.', category: 'utility' },
  { name: 'ParseXML', signature: 'ParseXML(xml as String) as Object', returnType: 'Object', description: 'Parses an XML string and returns an roXMLElement.', category: 'utility' },

  // IO
  { name: 'ReadAsciiFile', signature: 'ReadAsciiFile(filePath as String) as String', returnType: 'String', description: 'Reads the content of a text file and returns it as a string.', category: 'io' },
  { name: 'WriteAsciiFile', signature: 'WriteAsciiFile(filePath as String, text as String) as Boolean', returnType: 'Boolean', description: 'Writes text to a file at filePath. Returns true on success.', category: 'io' },

  // Filesystem
  { name: 'CopyFile', signature: 'CopyFile(source as String, destination as String) as Boolean', returnType: 'Boolean', description: 'Copies the file at source to destination. Returns true on success.', category: 'filesystem' },
  { name: 'CreateDirectory', signature: 'CreateDirectory(path as String) as Boolean', returnType: 'Boolean', description: 'Creates a new directory at path. Returns true on success. Does not create intermediate directories.', category: 'filesystem' },
  { name: 'DeleteDirectory', signature: 'DeleteDirectory(path as String) as Boolean', returnType: 'Boolean', description: 'Deletes the directory at path. The directory must be empty. Returns true on success.', category: 'filesystem' },
  { name: 'DeleteFile', signature: 'DeleteFile(path as String) as Boolean', returnType: 'Boolean', description: 'Deletes the file at path. Returns true on success.', category: 'filesystem' },
  { name: 'ListDir', signature: 'ListDir(path as String) as Object', returnType: 'Object', description: 'Returns an roArray of strings containing the names (not full paths) of all files and directories in path.', category: 'filesystem' },
  { name: 'MatchFiles', signature: 'MatchFiles(path as String, pattern as String) as Object', returnType: 'Object', description: 'Returns an roArray of filenames in path whose names match the shell-style glob pattern. Matches only filenames, not subdirectory contents.', category: 'filesystem' },
  { name: 'MoveFile', signature: 'MoveFile(source as String, destination as String) as Boolean', returnType: 'Boolean', description: 'Moves (renames) the file at source to destination. Returns true on success.', category: 'filesystem' },
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

