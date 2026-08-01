# BrightScript Syntax Reference

This document catalogs every BrightScript syntax construct supported by the parser, with examples of valid and invalid forms. It serves as both documentation and a test specification — every example listed here is (or should be) covered by a parser test.

**Authority**: All syntax rules are derived from the [official Roku BrightScript documentation](https://developer.roku.com/dev/docs/program-statements).

---

## Identifiers

### Valid
```brightscript
myVariable
_private
item2
name$          ' string-typed
count%         ' integer-typed
value!         ' float-typed
distance#      ' double-typed
bigId&         ' long-integer-typed
```

### Rules
- Must start with `[a-zA-Z_]`
- May contain `[a-zA-Z0-9_]`
- Case-insensitive (`myVar` and `MYVAR` refer to the same variable)
- May end with a type designator: `$` (String), `%` (Integer), `!` (Float), `#` (Double), `&` (LongInteger)
- Must not use a reserved word

---

## Literals

### Integers
```brightscript
255
125%           ' explicit integer type
&HFF           ' hex
&hABCD         ' hex (lowercase h)
```

### Long Integers
```brightscript
9876543210&
&hFEDCBA9876543210&
```

### Floats
```brightscript
2.01
1.23456E+30
2!             ' explicit float type
.5             ' leading decimal
```

### Doubles
```brightscript
1.23456789D-12
2.3#           ' explicit double type
```

### Strings
```brightscript
"hello"
""             ' empty string
""""           ' single quote character (escaped)
"she said ""hello"" to me"
```

### Boolean & Special
```brightscript
true
false
invalid
LINE_NUM       ' current line number
```

---

## Operators (precedence high to low)

| Precedence | Operators | Notes |
|---|---|---|
| 1 | `()` | Function call, grouping |
| 2 | `.` | Dot access |
| 3 | `[]` | Index/array access |
| 4 | `?.` `?[` `?(` `?@` | Optional chaining (Roku OS 11.0+) |
| 5 | `^` | Exponentiation (right-associative) |
| 6 | `-` `+` (unary) | Negation |
| 7 | `*` `/` `\` `MOD` | Multiplicative |
| 8 | `+` `-` | Additive |
| 9 | `<<` `>>` | Bitshift |
| 10 | `<` `>` `=` `<>` `<=` `>=` | Comparison |
| 11 | `NOT` | Unary logical/bitwise |
| 12 | `AND` | Logical/bitwise |
| 13 | `OR` | Logical/bitwise |

### Assignment operators
```brightscript
x = 1          ' simple assignment
x += 1         ' compound: add
x -= 1         ' compound: subtract
x *= 2         ' compound: multiply
x /= 2         ' compound: divide
x \= 2         ' compound: integer divide
x <<= 1        ' compound: left shift
x >>= 1        ' compound: right shift
x++            ' increment
x--            ' decrement
```

---

## Function / Sub Declarations

### Valid
```brightscript
function myFunc(a, b) as Integer
  return a + b
end function

sub mySub(x as String)
  print x
end sub

' Anonymous function
myfunc = function(a, b)
  return a + b
end function

' Default parameter values
function add(a as Integer, b=5 as Integer) as Integer
  return a + b
end function

' Default referencing other param
function add3(a as Integer, b=a+5 as Integer) as Integer
  return a + b
end function

' Sub with no params
sub doNothing()
end sub
```

### Invalid (must produce parse error)
```brightscript
function()                        ' missing end function
sub myFunc(                       ' unclosed param list
```

---

## If / Then / Else

### Valid
```brightscript
' Multi-line
if x > 0 then
  print "positive"
end if

' Multi-line with else if / else
if x > 0
  print "pos"
else if x < 0
  print "neg"
else
  print "zero"
end if

' Single-line
if x > 0 then print "yes"
if x then y = 1 else y = 2

' elseif (single word)
if a
  print 1
elseif b
  print 2
end if

' then is optional
if x > 0
  print "works without then"
end if
```

### Notes
- `then` is optional on multi-line if
- `elseif` and `else if` are equivalent
- `end if` and `endif` are equivalent
- Single-line if does NOT require `end if`

---

## For / For Each

### Valid
```brightscript
for i = 1 to 10
  print i
end for

for i = 10 to 1 step -1
  print i
end for

' next is an alternative to end for
for i = 1 to 5
  print i
next

for each item in collection
  print item
end for

' exit for / continue for
for i = 1 to 10
  if i = 5 then exit for
  if i mod 2 = 0 then continue for
  print i
end for
```

### Notes
- `end for`, `endfor`, and `next` are all valid terminators
- `exit for` exits the loop
- `continue for` skips to next iteration

---

## While

### Valid
```brightscript
while x > 0
  x = x - 1
end while

while true
  if done then exit while
  process()
end while
```

### Notes
- `end while` and `endwhile` are valid terminators
- `exit while` exits the loop
- `continue while` skips to next iteration
- Unlike `for`, `next` is NOT valid for `while`

---

## Try / Catch / Throw

### Valid
```brightscript
try
  print 1/0
catch e
  print e.message
end try

' Throw a string
throw "Cannot calculate negative factorial."

' Throw an AA with message
throw { message: "error", number: -1 }

' Nested try/catch
try
  try
    riskyOp()
  catch inner
    print inner.message
  end try
catch outer
  print outer.message
end try
```

### Invalid
```brightscript
catch e                   ' catch without try
throw 42                  ' numeric literal (invalid throw value)
throw [1, 2]             ' array literal (invalid throw value)
catch someArray[23]       ' array element (invalid catch variable)
catch obj.field           ' dotted name (invalid catch variable)
```

### Notes
- `end try` and `endtry` are equivalent
- Catch variable must be a simple identifier
- Throw operand should be a string or AA with `message` field

---

## Print

### Valid
```brightscript
print "hello"
print a; b; c             ' semicolons: no spacing
print a, b, c             ' commas: tab zones
? "shorthand"             ' ? is alias for print
print tab(5) "indented"
```

---

## Other Statements

### Valid
```brightscript
dim arr[5, 3]             ' declare array
return 42                 ' return with value
return                    ' void return
stop                      ' invoke debugger
end                       ' terminate execution
goto myLabel              ' jump to label
myLabel:                  ' label declaration

' Colon as statement separator
a = 1 : b = 2 : c = 3

' Single-line blocks with colon
for i = 0 to 5 : print i : end for
while true : exit while : end while
try : catch e : end try
```

---

## Array Literals

### Valid
```brightscript
[]                        ' empty
[1, 2, 3]                ' with commas
[1, 2, 3,]               ' trailing comma ok
["a", "b", "c"]
[x + 1, fn(), obj.val]   ' expressions as elements

' Multi-line (commas optional)
arr = [
  "able"
  "baker"
]

' Nested
matrix = [[1, 2], [3, 4]]
```

---

## Associative Array Literals

### Valid
```brightscript
{}                         ' empty
{ key: "value", num: 42 }
{ "Jane Doe": 1001 }      ' quoted keys

' Multi-line (commas optional)
aa = {
  key1: "value"
  key2: 42
}

' With function values
obj = {
  add: function(a, b)
    return a + b
  end function,
  value: 10
}
```

### Notes
- Keys can be identifiers or string literals
- Dot access (`aa.key`) is always case-insensitive
- Bracket access (`aa["Key"]`) preserves case
- `SetModeCaseSensitive()` makes bracket access case-sensitive (runtime behavior, not parser)

---

## Optional Chaining (Roku OS 11.0+)

### Valid
```brightscript
x = obj?.property
x = arr?[0]
x = callback?(arg1, arg2)
x = node?@attribute
x = a?.b?.c?[0]?.handler?(event)
```

### Notes
- `?.`, `?[`, `?(`, `?@` are indivisible tokens
- Returns `invalid` if LHS is invalid (instead of error)
- Cannot be used as assignment target: `a?.b = 1` is invalid

---

## Conditional Compilation

### Valid
```brightscript
#const DEBUG = true
#const FEATURE_A = false

#if DEBUG
  print "debug mode"
#else if FEATURE_A
  print "feature A"
#else
  print "release"
#end if

#error TODO: implement this feature
```

### Notes
- `#end if` and `#endif` are equivalent
- `#else if` and `#elseif` are equivalent
- `#const` only supports boolean values
- `#error` consumes the rest of the line as its message

### ⚠️ Not implemented: `#if false` as a block-comment idiom

Real Roku BrightScript skip-lexes an untaken conditional-compilation branch, so
`#if false` / arbitrary non-BrightScript text / `#end if` is a common idiom for
block-commenting code. **This parser does not do that** — `parseConditionalCompilation`
parses every branch's body as real statements regardless of the condition,
so non-BrightScript prose inside a `#if false` block produces diagnostics and
`ErrorNode`s, not a silently-skipped span. Implementing this properly needs a
lexer-level change (skip-scan the untaken branch as opaque text once the
condition is known statically false, accounting for `#const`-bound names) —
real work, not attempted here because nothing in this codebase currently
depends on it. If a real `.brs` file using this idiom shows up, verify the
skip-lexing approach against it before implementing (see the root CLAUDE.md's
rule against speculative changes) rather than guessing at the exact behavior.

---

## XML Attribute Access (`@`)

BrightScript uses `@` to access XML element attributes (from `roXMLElement`).

### Valid
```brightscript
width = node@width
height = node@height
data.imageWidth = Val(node@width)
id = item.node@id
```

### Notes
- `@` works like `.` but specifically for XML attributes
- `?@` is the optional chaining variant: `node?@width`
- Both produce a `DotExpression` node in the CST

---

## Type Designator Variables

Variables ending with a type suffix are **completely separate** from the unsuffixed version.

### Valid
```brightscript
a = 1              ' dynamic variable "a"
a$ = "hello"       ' String variable "a$" (separate from "a")
a% = 42            ' Integer variable "a%" (separate)
a! = 3.14          ' Float variable "a!" (separate)
a# = 2.71828       ' Double variable "a#" (separate)
a& = 9876543210    ' LongInteger variable "a&" (separate)
```

### Edge cases
```brightscript
a& = 123
print a    ' UNINITIALIZED — "a" was never assigned
print a&   ' 123 — "a&" is a different variable
```

### Notes
- The suffix is part of the identifier token: `a&` is one token, kind `Identifier`, text `"a&"`
- Scope resolution treats each suffix variant as a distinct variable
- Keywords with type suffix become identifiers: `end$` is an identifier, not the `end` keyword

---

## Statement Separator (`:`)

The colon `:` separates multiple statements on one line.

### Valid
```brightscript
a = 1 : b = 2 : c = 3
if x then a = 1 : b = 2
for i = 0 to 5 : print i : end for
while true : exit while : end while
try : catch e : end try
```

### As AA key-value separator
```brightscript
aa = { key: "value", num: 42 }     ' colon after key, NOT a statement separator
```

### Notes
- `:` inside `{}` (AA literal) is always a key-value separator
- `:` outside `{}` is always a statement separator
- Single-line blocks use `:` to put opener + body + closer on one line

---

## Trailing Commas & Multi-line Rules

### Trailing commas

| Context | Trailing comma allowed? |
|---|---|
| Array literal `[1, 2, 3,]` | ✅ Yes |
| AA literal `{ key: 1, }` | ✅ Yes |
| Function parameters `function foo(a, b,)` | ❌ No (compile error) |
| Function call arguments `foo(1, 2,)` | ❌ No (compile error) |

### Multi-line rules

| Context | Multi-line allowed? |
|---|---|
| Array literal | ✅ Yes — commas optional between lines |
| AA literal | ✅ Yes — commas optional between lines |
| Function parameters | ❌ No — must be on one line |
| Function call arguments | ❌ No — must be on one line |

### Exception: multi-line arguments containing sub/function, AA, or array

```brightscript
' This IS valid — the anonymous sub spans multiple lines
foo(sub()
  print 1
end sub, { key: 1 })

' This IS valid — AA argument spans lines
bar({
  name: "test",
  value: 42
})

' This is NOT valid — plain arguments on multiple lines
baz(
  1,
  2
)
```

---

## `m` Context Variable

`m` is a special implicit variable in BrightScript.

### Behavior
```brightscript
' When called from a SceneGraph component:
sub init()
  m.top           ' → the component's top-level node
  m.global        ' → global node
  m.myField = 1   ' → component scope field
end sub

' When called from an associative array:
obj = {
  value: 42,
  getValue: function()
    return m.value   ' → m is this AA (obj)
  end function
}
obj.getValue()       ' → m = obj, returns 42

' When stored as a standalone reference and called:
handler = obj.getValue
handler()            ' → m = component scope (NOT obj!)
                     ' because handler() is called without a dot receiver
```

### Notes
- `m` is always available — never needs declaration
- `m` type depends on HOW the function is called:
  - `obj.method()` → `m` = `obj` (the AA before the dot)
  - `standalone()` → `m` = component scope (SceneGraph) or module-level AA
- `m.top` is only available in SceneGraph component context
- Scope analysis never flags `m` as undefined
