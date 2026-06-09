# BrightScript Language Support

## Syntax Highlighting

The extension registers the `brightscript` language ID for `.brs` files and provides a TextMate grammar (`syntaxes/brightscript.tmLanguage.json`) with scopes for:

- **Keywords**: `sub`, `function`, `if`, `else`, `for`, `while`, `return`, `end`, `try`, `catch`, etc.
- **Storage types**: `Boolean`, `Integer`, `Float`, `Double`, `String`, `Object`, `Dynamic`, `Void`
- **Type annotations**: `as <type>` patterns — the type name receives `storage.type` scope even when it overlaps with a keyword (e.g. `as Function` highlights `Function` as a type, not a keyword)
- **Boolean/null literals**: `true`, `false`, `invalid`
- **Built-in functions**: `CreateObject`, `Abs`, `Len`, `ParseJson`, etc.
- **Strings**: double-quoted with `""` escape sequence support
- **Numbers**: integer, float, hex (`0x...`), type-suffixed (`!`, `#`, `%`, `&`)
- **Operators**: arithmetic, comparison, logical, string concatenation (`&`)
- **Function declarations**: function/sub name receives `entity.name.function` scope
- **Function calls**: any identifier followed by `(` receives `support.function` scope, matching built-in function colouring
- **`m` variable**: the BrightScript component scope variable `m` receives `storage.type` scope, matching type keyword colouring
- **Kopytko `@import` annotations**: specially highlighted (see [Kopytko Imports](./kopytko-imports.md))
- **Kopytko `@mock` annotations**: same structure as `@import` but with a distinct `keyword.control.mock` scope for `@mock` and `from` keywords; path and package name share the same scopes as `@import`

## Language Configuration

Configured in `language-configuration.json`:

- **Line comments**: apostrophe (`'`) and `REM`
- **Auto-closing pairs**: `()`, `[]`, `{}`, `""`
- **Indent rules**: increase after `sub`, `function`, `if`, `for`, `while`, `try`; decrease on `end sub`, `end function`, `end if`, etc.
- **Word pattern**: `[a-zA-Z_][a-zA-Z0-9_]*`

## Snippets

Available snippets (prefix → expansion):

| Prefix | Description |
|---|---|
| `sub` | Subroutine block |
| `fn` | Function with return type |
| `if` | If block |
| `ife` | If-else block |
| `foreach` | For-each loop |
| `for` | For loop |
| `while` | While loop |
| `try` | Try-catch block |
| `import` | Kopytko internal `@import` |
| `importfrom` | Kopytko external `@import ... from` |
| `kopytko-init` | Kopytko component init boilerplate |
| `aa` | AssociativeArray literal |
| `print` | Print statement |

### Test Snippets

Available in test files (`*.test.brs`):

| Prefix | Description |
|---|---|
| `testsuite` | Kopytko test suite scaffold |
| `testsuitefw` | Framework test suite scaffold (extends `KopytkoFrameworkTestSuite`) |
| `it` | Single test case with `it()` |
| `test` | Single test case with `test()` |
| `iteach` | Parameterized test case with `itEach()` |
| `beforeeach` | `beforeEach` setup block |
| `aftereach` | `afterEach` teardown block |
| `mockfn` | `mockFunction()` call with return value |
| `expect` | `expect()` assertion with matcher |
| `expectmock` | `expect()` assertion with mock matcher |
| `mock` | `@mock` annotation |

## BrightScript Language Reference

The official BrightScript language reference is at:
https://developer.roku.com/docs/references/brightscript/language/brightscript-language-reference.md

### Key language features supported

- Loosely typed by default; optional `as <Type>` annotations
- Functions as first-class values
- `m` reference to the component's associative array (equivalent to `this`)
- `invalid` as the null value
- Array and AssociativeArray literals (`[]`, `{}`)
- Exception handling via `try` / `catch` / `throw` / `end try`
- `for each ... in` iteration over arrays and associative arrays
- String concatenation with `+` or `&`
