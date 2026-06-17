# brightscript-parser

A hand-written, lossless BrightScript parser for the Kopytko ecosystem. Produces a Concrete Syntax Tree (CST) that preserves every byte of the original source — whitespace, comments, and all.

Used as the shared foundation for `kopytko-formatter`, `kopytko-linter`, and the Kopytko VS Code extension.

## Installation

```bash
npm install brightscript-parser
```

## Quick Start

```typescript
import { parse, walk, buildScopes, resolve, getSymbolInfo } from 'brightscript-parser';

// Parse BrightScript source → lossless CST
const result = parse(`
  function add(a as Integer, b as Integer) as Integer
    return a + b
  end function
`);

// Round-trip: CST → text reproduces the exact original
result.root.getText() === source; // true

// Check for parse errors
result.diagnostics; // [] means no errors

// Walk the AST with a visitor
walk(result.root, {
  visitFunctionDeclaration(node) {
    console.log(`Function: ${node.name}(${node.params.map(p => p.name).join(', ')})`);
  },
  visitCallExpression(node) {
    console.log(`Call: ${node.callee?.name}(${node.args.length} args)`);
  },
});

// Scope analysis — resolve variables across scopes
const scope = buildScopes(result.root);
const fnScope = scope.children[0];
resolve('a', fnScope); // → { name: 'a', kind: 'parameter', ... }

// Rich symbol info (for hover, go-to-definition)
const info = getSymbolInfo('add', result.root);
// → { name: 'add', kind: 'function', signature: 'function add(a as Integer, b as Integer) as Integer', ... }
```

## Architecture

```
Source text
    ↓
┌───────────────────────────────────────────────┐
│  Lexer (tokenize)                             │
│  source → Token[] with trivia (whitespace,    │
│           comments) attached to each token     │
└───────────────────────────────────────────────┘
    ↓
┌───────────────────────────────────────────────┐
│  Parser (parse)                               │
│  Token[] → SyntaxNode tree (lossless CST)     │
│  Error-tolerant: always produces a tree       │
└───────────────────────────────────────────────┘
    ↓
┌───────────────────────────────────────────────┐
│  Typed AST (wrapNode)                         │
│  SyntaxNode → FunctionDeclaration, IfStatement│
│  Zero-cost wrappers over CST nodes            │
└───────────────────────────────────────────────┘
    ↓
┌───────────────────────────────────────────────┐
│  Analysis                                     │
│  Scope, Type Inference, Call Graph,           │
│  Context (m) Analysis, Symbol Info            │
└───────────────────────────────────────────────┘
```

## How Tokenization Works

The lexer converts source text into tokens. Every byte is preserved — either as a token's `text` or as trivia attached to the token.

### Example

Source: `x = 42 ' my comment`

```
Token 1: Identifier "x"
  leadingTrivia: []
  trailingTrivia: [Whitespace " "]

Token 2: Equal "="
  leadingTrivia: []
  trailingTrivia: [Whitespace " "]

Token 3: IntegerLiteral "42"
  leadingTrivia: []
  trailingTrivia: [Whitespace " ", Comment "' my comment"]

Token 4: Eof ""
```

Reconstructing: `"" + "x" + " " + "" + "=" + " " + "" + "42" + " " + "' my comment" + ""` = `x = 42 ' my comment` ✅

### Token Kinds

| Category | Examples |
|---|---|
| **Keywords** (47) | `if`, `then`, `else`, `end if`, `function`, `sub`, `for`, `while`, `try`, `catch`, `return`, `print`, `and`, `or`, `not`, `mod`, ... |
| **Identifiers** | `myVar`, `name$` (String), `count%` (Integer), `value!` (Float), `dist#` (Double), `id&` (LongInteger) |
| **Literals** | `42` (Integer), `&HFF` (hex), `2.01` (Float), `1.23D-12` (Double), `"hello"` (String), `true`, `false`, `invalid` |
| **Operators** (23) | `+`, `-`, `*`, `/`, `\`, `^`, `=`, `<>`, `<`, `>`, `<=`, `>=`, `<<`, `>>`, `+=`, `-=`, `++`, `--`, ... |
| **Optional chaining** | `?.`, `?[`, `?(`, `?@` |
| **Punctuation** | `(`, `)`, `[`, `]`, `{`, `}`, `.`, `,`, `:`, `;`, `@` |
| **Preprocessor** | `#if`, `#else`, `#else if`, `#end if`, `#const`, `#error` |

### Type Designator Variables

Variables with type suffixes (`$`, `%`, `!`, `#`, `&`) are **separate variables** from their unsuffixed counterparts:

```brightscript
a& = 123
? a   ' UNINITIALIZED — "a" and "a&" are different variables
? a&  ' 123
```

The lexer includes the suffix in the token text (`"a&"` is one Identifier token), so scope analysis naturally treats them as distinct.

### Compound Keywords

The lexer recognizes both compact and spaced forms as the same token kind:

| Compact | Spaced | TokenKind |
|---|---|---|
| `endif` | `end if` | `EndIf` |
| `endfor` | `end for` | `EndFor` |
| `endsub` | `end sub` | `EndSub` |
| `endfunction` | `end function` | `EndFunction` |
| `endwhile` | `end while` | `EndWhile` |
| `endtry` | `end try` | `EndTry` |
| `elseif` | `else if` | `ElseIf` |
| `exitwhile` | `exit while` | `ExitWhile` |

## How the CST Works

The parser builds a tree where every node is either a `SyntaxNode` (with children) or a `Token` (leaf). The tree is **lossless** — `node.getText()` reproduces the original source.

### Example

Source: `if x > 0 then print "yes" end if`

```
SourceFile
├── IfStatement
│   ├── Token(If, "if")
│   ├── BinaryExpression
│   │   ├── IdentifierExpression
│   │   │   └── Token(Identifier, "x")
│   │   ├── Token(Greater, ">")
│   │   └── LiteralExpression
│   │       └── Token(IntegerLiteral, "0")
│   ├── Token(Then, "then")
│   ├── PrintStatement
│   │   ├── Token(Print, "print")
│   │   └── LiteralExpression
│   │       └── Token(StringLiteral, "\"yes\"")
│   └── Token(EndIf, "end if")
└── Token(Eof, "")
```

### Typed AST Wrappers

Each CST node kind has a zero-cost typed wrapper for convenient access:

```typescript
const fn = new FunctionDeclaration(syntaxNode);
fn.name;        // "add"
fn.params;      // [Parameter, Parameter]
fn.returnType;  // "Integer"
fn.isSub;       // false
fn.body;        // [ReturnStatement, ...]
fn.syntax;      // escape hatch to the raw SyntaxNode
```

## API Reference

### Core

| Function | Description |
|---|---|
| `tokenize(source)` | Source → Token[] (lossless token stream) |
| `parse(source)` | Source → ParseResult { root, diagnostics, tokens } |
| `tokensToText(tokens)` | Token[] → source string (round-trip) |

### AST

| Function | Description |
|---|---|
| `wrapNode(node)` | SyntaxNode → typed AST wrapper (FunctionDeclaration, etc.) |
| `walk(root, visitor)` | Depth-first walk with typed visitor callbacks |
| `findAll(root, kind, wrapFn)` | Collect all nodes of a specific kind |

### Scope Analysis

| Function | Description |
|---|---|
| `buildScopes(root)` | Build scope tree (functions, params, variables) |
| `resolve(name, scope)` | Case-insensitive name lookup up the scope chain |
| `findScopeAtLine(scope, line)` | Find innermost scope containing a line |

### Analysis

| Function | Description |
|---|---|
| `inferTypesFromAst(root)` | Build TypeMap: variable → possible types |
| `getVariableType(typeMap, name)` | Get most specific type for a variable |
| `buildCallGraph(root)` | Build call graph: who calls whom |
| `analyzeContext(root)` | Track `m.field` assignments and function bindings |
| `getSymbolInfo(name, root)` | Rich symbol data for hover/definition |

### Utilities

| Function | Description |
|---|---|
| `findNodeAtPosition(root, line, col)` | Find CST node at cursor position |
| `findTokenAtPosition(root, line, col)` | Find token at cursor position |
| `getWordAtPosition(line, col)` | Extract identifier word at position |
| `escapeRegex(str)` | Escape regex special characters |
| `matchesGlob(str, pattern)` | Glob pattern matching (`*`, `**`) |
| `parseXmlScriptUris(xml)` | Extract `<script>` URIs from XML |
| `parseXmlInterface(xml)` | Parse `<interface>` fields/functions |
| `parseXmlExtends(xml)` | Get `extends` attribute from `<component>` |

### Catalogs

| Export | Description |
|---|---|
| `BRIGHTSCRIPT_BUILTINS` | 58 built-in functions with signatures and docs |
| `BRIGHTSCRIPT_KEYWORDS` | 47 reserved words |
| `BRIGHTSCRIPT_COMPONENTS` | 60 ro* components with interfaces and methods |
| `findBuiltin(name)` | Look up a built-in function |
| `findComponent(name)` | Look up a ro* component |
| `getComponentMethods(name)` | Get all methods for a component |
| `applyCasing(text, option)` | Apply casing transform to identifier |
| `inferNumericLiteralType(str)` | Infer type from numeric literal string |

## BrightScript Syntax Rules

The parser enforces these BrightScript-specific rules:

| Rule | Valid | Invalid |
|---|---|---|
| Parameter list | `function foo(a, b)` | `function foo(a, b,)` (trailing comma) |
| Parameter list | Must be on one line | `function foo(\n  a,\n  b\n)` |
| Call arguments | `foo(1, 2)` | `foo(1, 2,)` (trailing comma) |
| Call arguments | Must be on one line | `foo(\n  1,\n  2\n)` |
| Array literals | Trailing comma OK | `[1, 2,]` ✅ |
| AA literals | Trailing comma OK | `{ k: 1, }` ✅ |
| Multi-line exceptions | Newlines OK inside sub/function, AA, array arguments | `foo(sub()\n...\nend sub)` ✅ |
| Case insensitive | `IF` = `if` = `If` | All equivalent |
| Type designators | `a$`, `a%`, `a!`, `a#`, `a&` are separate from `a` | |

## BrightScript Reference

Official Roku documentation (authoritative source for all grammar decisions):
- [Language Reference](https://developer.roku.com/dev/docs/brightscript-language-reference)
- [Program Statements](https://developer.roku.com/dev/docs/program-statements)
- [Expressions & Types](https://developer.roku.com/dev/docs/expressions-variables-types)
- [Reserved Words](https://developer.roku.com/dev/docs/reserved-words)
- [Conditional Compilation](https://developer.roku.com/dev/docs/conditional-compilation)

## License

MIT
