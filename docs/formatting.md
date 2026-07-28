# BrightScript Document Formatting

## Overview

The BrightScript formatter is a **hybrid multi-pass engine** that rewrites `.brs` files with structure-aware CST passes plus inline text/regex passes. `packages/formatter/src/cst-passes/index.ts` exports 28 CST pass files; `packages/formatter/src/formatter.ts` composes the enabled rules and keeps text-oriented transformations inline where they are still simpler.

CST passes run through a small bridge that joins the current lines, applies token/node-position edits, and splits back to lines. Consecutive style passes (`endKeywordStyle`, `functionVsSubForVoid`, `thenStyle`) are batched through `runCstPasses`, while single-pass CST transforms reuse a per-format parse cache. This parse-once batching keeps typical formatting to roughly two parser runs instead of repeatedly reparsing for every rule. Pass files are regular linted TypeScript modules; they no longer carry a blanket unused-variable ESLint disable.

**All rules are opt-in.** Defaults are chosen to preserve existing style — the formatter produces zero edits on an already-clean file until you enable rules explicitly.

String literal contents and trailing comments (`'…`) are preserved verbatim — formatting rules are only applied to the code portion of each line.

**Usage:** Run via *Format Document* (`Shift+Alt+F`), or enable `"editor.formatOnSave": true` in your VS Code settings.

**CLI usage:** The formatter is also available as a standalone CLI tool via the `kopytko-formatter` npm package. See the [kopytko-formatter README](../packages/formatter/README.md) for CI integration and library API.

**Implementation:** The formatting engine lives in `packages/formatter/src/formatter.ts`. The extension's `BrightScriptFormattingProvider` in `src/server/providers/formattingProvider.ts` is a thin LSP adapter that calls `formatText()` from the package.

---

## Quick Start

A minimal recommended configuration for common BrightScript projects:

```jsonc
// .vscode/settings.json
{
  "kopytko.format.indentSize": 4,
  "kopytko.format.trimTrailingWhitespace": true,
  "kopytko.format.insertFinalNewline": true,
  "kopytko.format.endKeywordStyle": "spaced",
  "kopytko.format.spaceAroundOperators": true,
  "kopytko.format.spaceAroundAssignment": true,
  "kopytko.format.maxEmptyLines": 2,
  "kopytko.format.emptyLinesBetweenFunctions": 1,
  "editor.formatOnSave": true
}
```

For stricter teams:

```jsonc
{
  "kopytko.format.indentSize": 2,
  "kopytko.format.endKeywordStyle": "spaced",
  "kopytko.format.thenStyle": "always",
  "kopytko.format.functionVsSubForVoid": "sub",
  "kopytko.format.spaceAroundOperators": true,
  "kopytko.format.commentStyle": "'",
  "kopytko.format.spaceAfterCommentMarker": true,
  "kopytko.format.sortImports": true,
  "kopytko.format.emptyLineAfterImports": true,
  "kopytko.format.emptyLineBeforeReturn": "not-alone",
  "kopytko.format.parenthesisIfCase": "always",
  "kopytko.format.printStatement": "remove"
}
```

---

## Indentation & Whitespace

---

**`kopytko.format.indentSize`**

| Type | Values | Default |
|---|---|---|
| `number` | Any positive integer | `4` |

Spaces per indent level. Indent depth is tracked across:

- `function`/`sub` — named and anonymous expressions (e.g. `callback = function() as Object`)
- `if … then`, `else if`/`elseif`, `else` — `else`/`elseif` deindent to the same level as `if`; single-line `if … then <statement>` does not increase indent
- `for`, `while`, `try…catch`
- Conditional compilation — `#if`, `#else if`/`#elseif`, `#else` (same deindent-then-indent pattern), `#end if`/`#endif`

Comment lines (starting with `'` or `rem`) are indented at the current depth but **never alter the indent depth** — commented-out `function`/`end function` bodies and `#if` blocks have no side-effects on indentation.

```brightscript
' indentSize: 2
function main()
  if true then
    print "hello"
  end if
end function

' indentSize: 4
function main()
    if true then
        print "hello"
    end if
end function
```

Conditional compilation example (`indentSize: 4`):

```brightscript
#const FeatureA = true
#const FeatureB = false

#if FeatureA
    ' code for Feature A
#else if FeatureB
    ' code for Feature B
#else
    ' production code
#end if
```

Anonymous function expression body is indented correctly even with a trailing inline comment on the opener:

```brightscript
SomeFunction(function () as Object ' Some comment
    someVariable = "hello"

    return { someVariable: someVariable }
end function)
```

Method-chain continuation lines (starting with `.`) are indented one level deeper than the line that started the chain. Object/array contents opened on a chain line nest from there:

```brightscript
' indentSize: 2
sub test()
  expect(foo)
    .toEquals({
      field1: 1,
      field2: 2
    })
end sub
```

---

**`kopytko.format.useTabs`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Use tab characters instead of spaces for indentation. When `true`, each indent level is one tab character regardless of `indentSize`.

```brightscript
' useTabs: false, indentSize: 4
function main()
    print "spaces"
end function

' useTabs: true
function main()
	print "tabs"
end function
```

---

**`kopytko.format.lineEnding`**

| Type | Values | Default |
|---|---|---|
| `string` | `"lf"`, `"crlf"`, `"auto"` | `"auto"` |

Line ending style. `"auto"` detects the document's dominant ending (LF vs CRLF) and preserves it. `"lf"` forces Unix-style endings; `"crlf"` forces Windows-style.

---

**`kopytko.format.trimTrailingWhitespace`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Remove trailing whitespace from all lines.

```brightscript
' Before (· = space):
name = "hello"····
count = 0··

' After (trimTrailingWhitespace: true):
name = "hello"
count = 0
```

---

**`kopytko.format.insertFinalNewline`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Ensure the file ends with a newline character. Many tools (git, linters) expect files to end with a trailing newline.

---

**`kopytko.format.maxEmptyLines`**

| Type | Values | Default |
|---|---|---|
| `number` | `0` = no limit, any positive integer | `2` |

Maximum consecutive blank lines allowed. Excess blank lines are removed.

```brightscript
' Before (maxEmptyLines: 1):
function first()
end function



function second()
end function

' After:
function first()
end function

function second()
end function
```

---

**`kopytko.format.emptyLinesBetweenFunctions`**

| Type | Values | Default |
|---|---|---|
| `number` | Any non-negative integer | `1` |

Number of blank lines to enforce between top-level `function`/`sub` declarations. Existing blank lines between functions are replaced with exactly this many.

```brightscript
' Before (emptyLinesBetweenFunctions: 2):
function first()
end function
function second()
end function

' After:
function first()
end function


function second()
end function
```

---

**`kopytko.format.emptyLinesBetweenMethods`**

| Type | Values | Default |
|---|---|---|
| `number` | Any non-negative integer | `1` |

Number of blank lines between AA method definitions inside a builder function.

```brightscript
' Before (emptyLinesBetweenMethods: 2):
function MyClass() as Object
  prototype = {}

  prototype.first = function ()
  end function
  prototype.second = function ()
  end function

  return prototype
end function

' After:
function MyClass() as Object
  prototype = {}

  prototype.first = function ()
  end function


  prototype.second = function ()
  end function

  return prototype
end function
```

---

**`kopytko.format.emptyLinesAtBlockBoundaries`**

| Type | Values | Default |
|---|---|---|
| `string` | `"strip"`, `"enforce"`, `"preserve"` | `"preserve"` |

Controls blank lines at the start and end of blocks (after openers like `function`, `if … then`, `for`, `while`, `try`, and before closers like `end function`, `end if`, `next`, `end while`, `end try`).

```brightscript
' "strip" — removes blank lines at block boundaries:
' Before:
function main()

    name = "hello"

end function

' After:
function main()
    name = "hello"
end function

' "enforce" — adds one blank line at block boundaries:
' Before:
function main()
    name = "hello"
end function

' After:
function main()

    name = "hello"

end function
```

---

## Compound Keywords

---

**`kopytko.format.endKeywordStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"spaced"`, `"compact"`, `"preserve"` | `"preserve"` |

Controls the style of compound end-keywords. Applies to all BrightScript end-keyword variants:

| Spaced | Compact |
|---|---|
| `end if` | `endif` |
| `end function` | `endfunction` |
| `end sub` | `endsub` |
| `end while` | `endwhile` |
| `end for` | `endfor` |
| `end try` | `endtry` |

```brightscript
' "spaced":
if condition then
    doSomething()
end if

function myFunc()
end function

sub mySub()
end sub

for i = 0 to 10
end for

while running
end while

' "compact":
if condition then
    doSomething()
endif

function myFunc()
endfunction

sub mySub()
endsub

for i = 0 to 10
endfor

while running
endwhile
```

---

**`kopytko.format.thenStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"always"`, `"never"`, `"multiline-only"`, `"singleline-only"`, `"preserve"` | `"preserve"` |

Controls the presence of the `then` keyword on `if`/`else if`/`elseif` lines. Note: single-line `if` statements (where a statement follows `then` on the same line) always require `then` and are not stripped even with `"never"`.

```brightscript
' "always" — adds then to all if-lines:
if count > 0 then
    doSomething()
end if

else if name = "test" then
    doOther()
end if

' "never" — removes then from multi-line ifs (single-line ifs keep then):
if count > 0
    doSomething()
end if

' single-line if — then is always preserved:
if count > 0 then doSomething()

' "multiline-only" — adds then to multi-line ifs only:
if count > 0 then
    doSomething()
end if

' "singleline-only" — removes then from multi-line ifs, keeps on single-line:
if count > 0
    doSomething()
end if

if count > 0 then doSomething()
```

---

## Functions & Subs

---

**`kopytko.format.functionVsSubForVoid`**

| Type | Values | Default |
|---|---|---|
| `string` | `"function"`, `"sub"`, `"allow-void"`, `"preserve"` | `"preserve"` |

Controls whether void procedures use `sub` or `function`. When set to `"sub"`, functions that return `void` (or have no return type annotation) are converted to `sub`. When set to `"function"`, all `sub` declarations are converted to `function`. The matching `end sub`/`end function` keyword is updated accordingly. This applies to both named declarations and anonymous function expressions.

```brightscript
' "sub" — converts void functions to sub:
' Before:
function doSomething(name as string)
    print name
end function

' After:
sub doSomething(name as string)
    print name
end sub

' Anonymous functions are also converted:
' Before:
callback = function() as Void
    print "hello"
end function

' After:
callback = sub()
    print "hello"
end sub

' Non-void functions are left unchanged:
function getName() as string
    return m.name
end function

' "function" — converts all subs to function:
' Before:
sub init()
    m.count = 0
end sub

' After:
function init()
    m.count = 0
end function

' "allow-void" — keeps both styles as valid:
sub init()           ' ← sub stays as sub
end sub
function cleanup() as Void   ' ← function with Void stays as-is
end function
```

---

**`kopytko.format.spaceBeforeNamedFunctionParens`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Space before `(` in named function/sub definitions.

```brightscript
' false (default):
function doSomething(name as String)
end function
sub init()
end sub

' true:
function doSomething (name as String)
end function
sub init ()
end sub
```

---

**`kopytko.format.spaceBeforeAnonymousFunctionParens`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Space before `(` in anonymous function expressions (assigned to variables or AA fields).

```brightscript
' false (default):
m.handler = function(event)
  ' ...
end function
this.onClick = sub()
end sub

' true:
m.handler = function (event)
  ' ...
end function
this.onClick = sub ()
end sub
```

---

**`kopytko.format.spaceBeforeCallParens`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Space before `(` in function calls.

```brightscript
' false (default):
result = getValue(key)
doSomething("hello")
arr.Push(item)

' true:
result = getValue (key)
doSomething ("hello")
arr.Push (item)
```

---

**`kopytko.format.spaceInsideParens`**

| Type | Values | Default |
|---|---|---|
| `string` | `"never"`, `"always"` | `"never"` |

Controls spacing inside `()` in function calls and definitions.

```brightscript
' "never":
result = getValue(key, default)

' "always":
result = getValue( key, default )
```

---

**`kopytko.format.paramAlignmentStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"preserve"`, `"indent"`, `"align-to-paren"` | `"preserve"` |

Multi-line parameter alignment style.

- **`"preserve"`** — leaves parameter alignment as written (default).
- **`"indent"`** — one indent level from the function keyword.
- **`"align-to-paren"`** — aligns to the opening parenthesis.

```brightscript
' "indent" — one indent level from the function keyword:
function createUser(
    name as string,
    age as integer,
    email as string
) as object

' "align-to-paren" — aligns to the opening parenthesis:
function createUser(name as string,
                    age as integer,
                    email as string) as object
```

---

## Strings

---

**`kopytko.format.maxLineLength`**

| Type | Values | Default |
|---|---|---|
| `integer` | `0` – ∞ | `120` |

Maximum line length before the formatter wraps long strings (when `wrapLongStrings` is not `"preserve"`). Set to `0` to disable wrapping.

---

**`kopytko.format.wrapLongStrings`**

| Type | Values | Default |
|---|---|---|
| `string` | `"preserve"`, `"plus"`, `"array-join"` | `"preserve"` |

How to break long string literals.

- **`"preserve"`** — leaves long strings as-is.
- **`"plus"`** — breaks with `+` concatenation.
- **`"array-join"`** — breaks with `[..., ...].join("")`.

```brightscript
' "preserve" — long string stays on one line:
message = "This is a very long string that exceeds the configured print width but is left unchanged"

' "plus" — breaks with + concatenation:
message = "This is a very long string that exceeds " + _
    "the configured print width and is split " + _
    "using plus concatenation"

' "array-join" — breaks with array join:
message = ["This is a very long string that exceeds ", _
    "the configured print width and is split ", _
    "using array join"].join("")
```

---

**`kopytko.format.stringConcatStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"preserve"`, `"plus"`, `"array-join"` | `"preserve"` |

Normalizes string concatenation style.

```brightscript
' "plus":
result = "Hello" + " " + name + "!"

' "array-join":
result = ["Hello", " ", name, "!"].join("")
```

---

## Arrays & Associative Arrays

---

**`kopytko.format.associativeArrayBracketSpacing`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Controls spaces inside `{}` for associative array literals.

```brightscript
' true:
config = { name: "app", version: "1.0" }

' false:
config = {name: "app", version: "1.0"}
```

---

**`kopytko.format.associativeArrayCommaSpacing`**

| Type | Values | Default |
|---|---|---|
| `string` | `"preserve"`, `"after"`, `"before"`, `"both"`, `"none"` | `"preserve"` |

Controls spaces around commas separating key-value pairs in **inline** associative arrays `{}`. Only applies to commas on the same line as `{` and `}` — multi-line AAs are not affected.

```brightscript
' "after" — space after comma only:
config = { a: 1, b: 2 }

' "before" — space before comma only:
config = { a: 1 ,b: 2 }

' "both" — space on both sides:
config = { a: 1 , b: 2 }

' "none" — no spaces around commas:
config = { a: 1,b: 2 }

' "preserve" — leave as written (default)
```

---

**`kopytko.format.trailingComma`**

| Type | Values | Default |
|---|---|---|
| `string` | `"never"`, `"always"`, `"multiline"` | `"never"` |

Trailing comma after the **last** item in multi-line arrays and associative arrays.

```brightscript
' "never":
config = {
    name: "app",
    version: "1.0"
}

' "always" / "multiline":
config = {
    name: "app",
    version: "1.0",
}
```

---

**`kopytko.format.arrayCommaStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"always"`, `"never"`, `"preserve"` | `"preserve"` |

Controls comma separators **between** items in multi-line arrays. BrightScript allows omitting commas entirely when items are on separate lines.

```brightscript
' "always" — explicit commas:
arr = [
    1,
    2,
    3,
]

' "never" — newline as separator:
arr = [
    1
    2
    3
]
```

> Single-line arrays always keep commas regardless of this setting: `arr = [1, 2, 3]`

---

**`kopytko.format.associativeArrayCommaStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"always"`, `"never"`, `"preserve"` | `"preserve"` |

Controls comma separators **between** entries in multi-line associative arrays. BrightScript allows omitting commas when entries are on separate lines.

```brightscript
' "always" — explicit commas:
config = {
    name: "app",
    version: "1.0",
    debug: true,
}

' "never" — newline as separator:
config = {
    name: "app"
    version: "1.0"
    debug: true
}
```

> Single-line AAs always keep commas regardless: `config = { name: "app", version: "1.0" }`

---

**`kopytko.format.associativeArraySingleLineThreshold`**

| Type | Values | Default |
|---|---|---|
| `number` | `0` = no limit, any positive integer | `0` |

Maximum number of keys before forcing an associative array to multi-line. For example, setting this to `3` means AAs with 4+ keys are always expanded to multi-line.

---

**`kopytko.format.arraySplitOpenBracket`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

When `true`, splits `[{` onto separate lines in multi-item arrays for better readability.

```brightscript
' true:
return [
  {
    name: "Component",
  },
  otherItem()
]

' false:
return [{
    name: "Component",
  },
  otherItem()
]
```

---

## Operators & Expressions

---

**`kopytko.format.spaceAroundOperators`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Enforce spaces around binary operators. Applies to arithmetic (`+`, `*`, `/`, `\`), comparison (`<>`, `<=`, `>=`, `<<`, `>>`), and logical operators.

Compound assignment operators (`+=`, `-=`, `*=`, `/=`, `\=`) are treated as single tokens — the operator and `=` are never split apart.

Increment (`++`) and decrement (`--`) operators are also treated as atomic tokens and are never split.

```brightscript
' true:
' Before:
result = a+b*c
total = count<>0
flags = bits<<2
url+="/"
x++
x--

' After:
result = a + b * c
total = count <> 0
flags = bits << 2
url += "/"
x++
x--

' false — preserves existing spacing as-is.
```

---

**`kopytko.format.spaceAroundAssignment`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Enforce spaces around `=` in assignments. Does not affect comparison operators (`<>`, `<=`, `>=`) or compound assignment operators (`+=`, `-=`, `*=`, `/=`, `\=`).

```brightscript
' true:
' Before:
name="hello"
count=0

' After:
name = "hello"
count = 0
```

---

**`kopytko.format.unarySpacing`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Enforce a space after the unary `not` operator.

```brightscript
' true:
' Before:
if not(valid) then

' After:
if not (valid) then
```

---

## Comments

---

**`kopytko.format.commentStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"'"`, `"rem"`, `"preserve"` | `"preserve"` |

Normalize comment markers to either single-quote (`'`) or `rem` keyword. `@import` comments are never touched.

```brightscript
' "'":
' Before:
rem This is a comment
rem Another comment

' After:
' This is a comment
' Another comment

' "rem":
' Before:
' This is a comment
' Another comment

' After:
rem This is a comment
rem Another comment
```

---

**`kopytko.format.spaceAfterCommentMarker`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Enforce a space after the comment marker (`'` or `rem`).

```brightscript
' true:
' Before:
'This is a comment
rem This is OK
'another comment

' After:
' This is a comment
rem This is OK
' another comment
```

---

**`kopytko.format.commentWidth`**

| Type | Values | Default |
|---|---|---|
| `number` | `0` = no limit, any positive integer | `0` |

Maximum comment line length. Long comments are word-wrapped to fit within this limit. Each wrapped line preserves the original indent and comment marker.

```brightscript
' commentWidth: 60
' Before:
' This is a very long comment that exceeds the configured maximum line width for comments

' After:
' This is a very long comment that exceeds
' the configured maximum line width for
' comments
```

---

## Imports & Namespaces

---

**`kopytko.format.sortImports`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Sort `@import` statements alphabetically. Module imports (using `from` syntax) are sorted by package name first, then by export name. Local imports are sorted by path. Module imports are grouped before local imports.

In test files, `@mock` annotations are also sorted using the same rules and placed after all `@import` annotations. Within the `@mock` group, module mocks sort before local mocks.

```brightscript
' Before:
' @import /components/utils/StringUtils.brs
' @import /components/Button.brs
' @import /components/HttpRequest.brs from @dazn/kopytko-utils
' @import /components/ArrayUtils.brs from @dazn/kopytko-utils
' @import /components/Logger.brs from @dazn/kopytko-framework
' @import /components/api/ApiClient.brs

' After (sortImports: true):
' @import /components/Logger.brs from @dazn/kopytko-framework
' @import /components/ArrayUtils.brs from @dazn/kopytko-utils
' @import /components/HttpRequest.brs from @dazn/kopytko-utils
' @import /components/api/ApiClient.brs
' @import /components/Button.brs
' @import /components/utils/StringUtils.brs
```

Test file example with `@mock`:

```brightscript
' Before:
' @mock /components/Zebra.brs
' @import /components/Button.brs
' @mock /components/Alpha.brs
' @import /components/Logger.brs from @dazn/kopytko-framework

' After (sortImports: true):
' @import /components/Logger.brs from @dazn/kopytko-framework
' @import /components/Button.brs
' @mock /components/Alpha.brs
' @mock /components/Zebra.brs
```

---

**`kopytko.format.emptyLineAfterImports`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Insert a blank line after the last annotation line (`@import` or `@mock`), before code starts. In test files with both `@import` and `@mock` annotations, the blank line is placed after the last `@mock`. This setting works independently of `sortImports`.

```brightscript
' emptyLineAfterImports: true
' @import /components/Logger.brs from @dazn/kopytko-framework
' @import /components/Button.brs
' @import /components/utils/StringUtils.brs

sub init()
  ' code starts here — blank line above separates imports from code
end sub
```

```brightscript
' emptyLineAfterImports: false
' @import /components/Logger.brs from @dazn/kopytko-framework
' @import /components/Button.brs
sub init()
  ' no blank line between imports and code
end sub
```

---

## Blank Line Rules

---

**`kopytko.format.emptyLineAfterFunctionOpen`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Insert a blank line after the opening line of a `function`/`sub` declaration.

```brightscript
' true:
function init()

    m.count = 0
    m.name = "default"
end function

' false:
function init()
    m.count = 0
    m.name = "default"
end function
```

---

**`kopytko.format.emptyLineBeforeFunctionClose`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Insert a blank line before `end function`/`end sub`.

```brightscript
' true:
function init()
    m.count = 0
    m.name = "default"

end function

' false:
function init()
    m.count = 0
    m.name = "default"
end function
```

---

**`kopytko.format.emptyLineBeforeReturn`**

| Type | Values | Default |
|---|---|---|
| `string` or `boolean` | `"always"`, `"not-alone"`, `false` | `false` |

Controls whether a blank line is inserted before `return` statements.

- **`false`** — no blank line is inserted (default).
- **`"always"`** — always insert a blank line before every `return`, regardless of context.
- **`"not-alone"`** — insert a blank line only when the `return` is **not** the only statement in its block. When a block contains nothing but a `return` (including anonymous function bodies), no blank line is added.

In both `"always"` and `"not-alone"` modes, **no blank line is inserted between a comment and the `return` directly below it** — the comment is considered part of the return statement. Any separation should be placed before the comment (e.g. via `emptyLineBeforeComment`).

```brightscript
' "always" — blank line before every return:
function getName() as string
    name = m.firstName + " " + m.lastName

    return name
end function

function getDefault() as string

    return "unknown"
end function

' "not-alone" — blank line only when return has sibling statements:
function getName() as string
    name = m.firstName + " " + m.lastName

    return name
end function

' return is alone in this block — no blank line:
function getDefault() as string
    return "unknown"
end function

' return is alone in anonymous function body — no blank line:
SomeFunction(function () as Boolean
    return true
end function)

' comment above return — blank line goes before the comment, not before the return:
SomeFunction(function () as Object
    someVariable = "hello"

    ' Some comment above return
    return { someVariable: someVariable }
end function)

' false — no blank line inserted:
function getName() as string
    name = m.firstName + " " + m.lastName
    return name
end function
```

---

**`kopytko.format.emptyLineBeforeComment`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Enforce a blank line before stand-alone comment blocks. `@import` comments are excluded — no blank line is added before them.

```brightscript
' true:
count = 0

' Initialize the name
name = "default"

' false:
count = 0
' Initialize the name
name = "default"
```

---

## Control Flow

---

**`kopytko.format.parenthesisIfCase`**

| Type | Values | Default |
|---|---|---|
| `string` | `"preserve"`, `"always"`, `"never"` | `"preserve"` |

Controls whether `if`/`else if`/`elseif` conditions are wrapped in parentheses.

```brightscript
' "always" — wraps conditions in parentheses:
' Simple condition:
' Before:
if count > 0 then

' After:
if (count > 0) then

' Compound condition:
' Before:
if name = "test" and count > 0 then

' After:
if (name = "test" and count > 0) then

' Already parenthesized — no change:
if (isValid) then

' Nested parentheses — outer parens added:
' Before:
if (a > 0) or (b > 0) then

' After:
if ((a > 0) or (b > 0)) then

' "never" — removes outer parentheses:
' Before:
if (count > 0) then

' After:
if count > 0 then

' Before:
else if (name = "test") then

' After:
else if name = "test" then
```

---

**Catch parentheses**

The formatter always strips parentheses from the `catch` variable because BrightScript does not allow them — `catch (e)` is a compilation error.

```brightscript
' Before:
catch (err)

' After:
catch err
```

Trailing comments on the `catch` line are preserved unchanged.

---

**`kopytko.format.elseOnNewLine`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Controls whether `else` appears on its own line.

```brightscript
' true:
if count > 0 then
    doSomething()
else
    doOther()
end if
```

---

**`kopytko.format.forLoopSpacing`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Enforce spaces around `to` and `step` keywords in `for` loops.

```brightscript
' true:
' Before:
for i = 0to10step2

' After:
for i = 0 to 10 step 2
```

---

## Miscellaneous

---

**`kopytko.format.printStatement`**

| Type | Values | Default |
|---|---|---|
| `string` | `"warn"`, `"remove"`, `"preserve"` | `"preserve"` |

Controls handling of `print` and `?` debug statements.

- **`"preserve"`** — leaves print statements as-is.
- **`"remove"`** — removes all `print` and `?` lines from the file during formatting.
- **`"warn"`** — flags print statements (for diagnostic integration).

```brightscript
' "remove":
' Before:
function init()
    print "debug: starting init"
    m.count = 0
    ? "count is "; m.count
end function

' After:
function init()
    m.count = 0
end function
```

---

**`kopytko.format.lineCommentPosition`**

| Type | Values | Default |
|---|---|---|
| `string` | `"above"`, `"inline"`, `"preserve"` | `"preserve"` |

Controls placement of trailing comments.

- **`"preserve"`** — leaves comments where they are.
- **`"above"`** — moves trailing comments to the line above the code.
- **`"inline"`** — keeps comments on the same line as code.

```brightscript
' "above":
' Before:
count = 0 ' initialize counter

' After:
' initialize counter
count = 0

' "inline":
' Before:
' initialize counter
count = 0

' After:
count = 0 ' initialize counter
```

## BrightScript Patterns

---

**`kopytko.format.observeFieldStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"always-scoped"`, `"warn"`, `"preserve"` | `"preserve"` |

Controls usage of `observeField` vs `observeFieldScoped`. Using non-scoped `observeField` can cause memory leaks because the observer is not automatically cleaned up when the observing node is destroyed.

```brightscript
' "always-scoped" — converts observeField to observeFieldScoped:
' Before:
m.top.observeField("visible", "onVisibleChange")

' After:
m.top.observeFieldScoped("visible", "onVisibleChange")
```

> **Note:** `"warn"` mode does not modify code — it flags `observeField` calls via a diagnostic warning.

---

**`kopytko.format.mPrefixStyle`**

| Type | Values | Default |
|---|---|---|
| `string` | `"dot"`, `"bracket"`, `"preserve"` | `"preserve"` |

Normalizes field access on `m` (the component scope object). BrightScript supports both dot notation and bracket notation.

```brightscript
' "dot":
m.fieldName
m.top.visible
m._privateField

' "bracket":
m["fieldName"]
m.top["visible"]
m["_privateField"]
```

> Bracket notation is useful when field names are dynamic or contain special characters. The `"dot"` style is more idiomatic for static field names.

---

**`kopytko.format.alignAssignments`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `false` |

Aligns `=` signs in consecutive assignment lines for visual readability.

```brightscript
' true:
name    = "app"
version = "1.0"
count   = 42
isReady = true

' false:
name = "app"
version = "1.0"
count = 42
isReady = true
```

> Only consecutive assignment lines are aligned. A blank line, comment, or non-assignment statement breaks the alignment group.

---

**`kopytko.format.fieldAccessConsistency`**

| Type | Values | Default |
|---|---|---|
| `string` | `"dot"`, `"method"`, `"preserve"` | `"preserve"` |

Normalizes field access on SceneGraph nodes between dot notation and `getField`/`setField` methods.

```brightscript
' "dot" — prefers dot notation:
m.top.visible = true
value = m.top.id
m.top.title = "Hello"

' "method" — prefers getField/setField:
m.top.setField("visible", true)
value = m.top.getField("id")
m.top.setField("title", "Hello")
```

> Dot notation is more readable; `getField`/`setField` is sometimes needed for dynamic field names or when the field name is a reserved word.

---

**`kopytko.format.verifySyntax`**

| Type | Values | Default |
|---|---|---|
| `boolean` | `true`, `false` | `true` |

Verifies that formatted output re-parses to an equivalent AST before applying it, catching formatter bugs. Disable only to debug or skip that safety check.

---

## CLI & CI Usage

The formatting engine is available as a standalone CLI tool via the `kopytko-formatter` npm package, independent of VS Code.

### Installation

```bash
npm install --save-dev kopytko-formatter
```

### Recommended npm Scripts

Add these scripts to your project's `package.json`:

```json
{
  "scripts": {
    "format": "kopytko-format --write app",
    "format:check": "kopytko-format --check app"
  }
}
```

Then run:

```bash
npm run format          # format files in place
npm run format:check    # CI — exit 1 if any file needs formatting
```

### Commands

```bash
# Check mode — exit 1 if any file needs formatting (use in CI)
kopytko-format --check app

# Write mode — format files in place
kopytko-format --write app

# With explicit config and ignore patterns
kopytko-format --check --config kopytko-formatter.json --ignore "**/_tests/**" app
```

### Config resolution

The CLI reads config from (in priority order):

1. `--config <file>` — explicit path
2. `kopytko-formatter.json` — in the current directory
3. `.vscode/settings.json` — reads `kopytko.format.*` and `kopytko.casing.*` keys automatically

If your project already has formatting settings in `.vscode/settings.json`, the CLI picks them up with no extra config.

### Ignoring files

Exclude paths from formatting via the `ignore` array in your config or the `--ignore` CLI flag:

```jsonc
// kopytko-formatter.json
{
  "indentSize": 2,
  "ignore": [
    "**/node_modules/**",
    "**/dist/**",
    "**/_tests/**"
  ]
}
```

Patterns use glob syntax: `*` matches within a path segment, `**` matches any depth. CLI `--ignore` flags are merged with config `ignore` patterns.

### GitHub Actions

```yaml
name: Format Check
on: [push, pull_request]
jobs:
  format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run format:check
```

### Library API

```typescript
import { formatText, checkFormatting, DEFAULT_FORMATTING_CONFIG } from 'kopytko-formatter';

const formatted = formatText(source, { ...DEFAULT_FORMATTING_CONFIG, indentSize: 2 });
const isClean = checkFormatting(source, DEFAULT_FORMATTING_CONFIG);
```

See the [kopytko-formatter README](../packages/formatter/README.md) for the full API reference.
