# LSP Server Architecture & How-To Guides

---

## Performance rules (mandatory for all LSP providers)

1. **Debounced diagnostics** — use `scheduleValidation()`, not `validateDocument()` (300ms stale-request-ID debounce). Direct calls block the UI thread on every keystroke.
2. **Document cache** — import from `utils/documentCache.ts`: `getCachedLines`, `getCachedTypeMap`, `getCachedAllFunctions`. Never call `text.split()`, `inferTypes()`, or `collectAllFunctions()` directly in a provider — these are expensive and uncached.
3. **Static data cached** — `getInstalledKopytkoPackages()`, `resolvePackageBaseDir()` are cached in the import resolver; `KopytkoModuleCatalog` scans once at startup. Both invalidate via `onDidChangeWatchedFiles`.
4. **Workspace function index** — use `WorkspaceFunctionIndex` for Find References, Rename, and Workspace Symbol search (all query it, never walk the disk directly). There is no standalone `collectBrsFiles`/`brsFileCollector.ts` any more — it was a raw uncached workspace walk that `workspaceSymbolProvider.ts` used to call on every keystroke of "Go to Symbol in Workspace"; it was deleted once that provider was wired to the index like the others. If a provider seems to need a fresh full-workspace walk, that is a sign it should be reading from an index instead, not a reason to re-add a walker.
5. **Catalog lookups** — `findComponent()`, `findBuiltin()`, `getComponentMethods()` are O(1) map lookups.
6. **Cache invalidation** — `CacheInvalidationService` handles `onDidChangeWatchedFiles` and clears/updates caches on disk changes. Document caches auto-invalidate on version change.

---

## New LSP feature checklist

1. Create `src/server/providers/<name>Provider.ts`
2. Wire in `server.ts` (instantiate + declare capability) and `registerHandlers.ts` (register handler)
3. Use the document cache — import from `utils/documentCache.ts`
4. Add tests in `test/providers/<name>Provider.test.ts`
5. Update `docs/features.md` (mark ✅) and `docs/language-server.md`

### ⛔ Never add `.xml` to the client's `documentSelector`

`src/client/activation/languageServer.ts` selects `.brs` + `.kopytkorc` only, and that is load-bearing.
The selector is per-client, not per-capability: adding XML to it advertises **every** capability for
XML files. `documentFormattingProvider` is the dangerous one — our formatter returns nothing for XML
(`getBrsDocument` rejects it), but VS Code would still offer it as an XML formatter and can shadow the
built-in one. Semantic tokens and document symbols have the same shape of problem.

When a feature genuinely needs XML (type hierarchy does — SceneGraph `extends` lives in XML), register
that **one** capability dynamically instead, as `registerXmlTypeHierarchy()` in `server.ts` does:

```ts
connection.client.register(TypeHierarchyPrepareRequest.type, {
  documentSelector: [{ scheme: 'file', language: 'xml', pattern: '**/*.xml' }],
});
```

Two things to know before copying this:

- **The registration type is the *request* type** (`TypeHierarchyPrepareRequest.type`), not a
  `…RegistrationType` — no such export exists in `vscode-languageserver` v10. `TypeHierarchyFeature`
  in `vscode-languageclient` registers under `TypeHierarchyPrepareRequest.type`, so anything else is
  silently ignored. Gate the call on
  `params.capabilities.textDocument?.typeHierarchy?.dynamicRegistration`.
- **The document is not synced.** The client only sends `didOpen`/`didChange` for documents matching
  its own `documentSelector`, and dynamic server-side registration does not change that. So the
  handler must not use `services.getBrsDocument` — it gets `documents.get(uri)` (usually `undefined`
  for XML) and falls back to `readCachedFileText`. That text is disk state: unsaved XML edits are
  invisible, and a position can point at stale text. `typeHierarchyProvider.prepare` absorbs this by
  ending with a position-independent fallback ("the component this file declares") instead of
  returning nothing.

---

## Formatter: adding a new option

1. Add field to `FormattingConfig` in `packages/formatter/src/config.ts`
2. Wire it in `packages/formatter/src/formatter.ts`
3. Add VS Code setting in root `package.json` → `contributes.configuration`
4. **Mirror the field into `src/server/brightscript/formattingConfig.ts`.** This file is a
   hand-maintained *duplicate* of `config.ts`'s `FormattingConfig`/`DEFAULT_FORMATTING_CONFIG`/
   `parseFormattingConfig` — not a re-export — and it's the copy `server.ts` actually builds the
   config from for the LSP *Format Document* command. `arrayCommaSpacing`/`parenCommaSpacing`
   shipped without ever being added here, so both options silently no-opped through the editor
   (only worked via the CLI, which imports the real package) until the AA/XML-sort feature's
   config additions caught it. There is no compiler error for a missing field here — this file's
   `parseFormattingConfig` builds the return object with explicit named properties, not a generic
   loop over `Object.keys`, so a field simply absent from both files never surfaces as a type
   error; it just quietly reads as the hardcoded default forever.
5. Update `docs/formatting.md`
6. Update `packages/formatter/README.md`'s options table and `formatterOptions`-count line (`(\d+) fields`) — machine-checked by `scripts/check-doc-claims.mjs`, which also checks `README.md` and `docs/features.md`'s `(\d+) configurable options` and `site/src/pages/index.astro`'s `Formatter options` stat. `site/src/pages/formatter.astro`'s option-card list and header count and `site/src/components/FormatterPlayground.tsx`'s JSONC config template are **not** in that checker — grep both for the option's neighbors by hand; a genuinely missing option (not just a stale count) can sit there for a long time undetected (`associativeArrayCommaSpacing` had no card on the reference page at all, and `paramAlignmentStyle`/`elseOnNewLine` were wrongly marked "(not yet implemented)" in the playground template, both discovered only when adding `arrayCommaSpacing`/`parenCommaSpacing` alongside them; `extension.astro`'s "Formatting" section had also drifted to a stale "49" independent of both).

**Bracket-context comma spacing (`associativeArrayCommaSpacing` / `arrayCommaSpacing` / `parenCommaSpacing` in `applyBracketAndCommaSpacing`, `formatter.ts`):** each comma is spaced according to whichever bracket *most immediately* encloses it — not a flat depth count per bracket type. A flat counter (`braceDepth > 0 && parenDepth === 0 && squareDepth === 0`, the original AA-only implementation) breaks the moment brackets nest in a different order than "AA at the outermost" — e.g. an AA nested inside an array (`[{a: 1, b: 2}]`) would never get `associativeArrayCommaSpacing` applied to its internal comma, since `squareDepth` is 1 at that point even though the *immediately* enclosing bracket is `{`. The fix is a single stack of `'{' | '[' | '('` pushed/popped on every opener/closer; a comma's mode is `stack[stack.length - 1]`. This generalizes correctly to arbitrary nesting (array-of-AAs, AA-with-array-values, array-of-calls, ...) for free, and is why array/paren comma-spacing landed as one rewrite of the existing AA-only function rather than three parallel copies.

## Formatter: adding a new rule / CST pass

Edit `packages/formatter/src/formatter.ts` for inline text/regex passes, or add a file to `packages/formatter/src/cst-passes/` and export it from `cst-passes/index.ts` for structure-aware passes. Run tests with `cd packages/formatter && npm test`.

**Migrating an existing regex pass to CST — this sweep was complete, then partially reopened.** All ~20 original regex passes in `formatter.ts` have a verdict: 9 ported to CST (`observeFieldStyle`, `mPrefixStyle`, `fieldAccessConsistency`, `lineCommentPosition`, `trailingCommas`, `parenthesisIfCase`, `stringConcatStyle`, `elseOnNewLine`, `aaThreshold`), 11 investigated and deliberately staying regex (`stripCatchParens`, `paramAlignment` — architecturally blocked by the parse-first rule; `alignAssignments`, `spacing`, `indentation`, `commentWidth`, `blankLines`, `emptyLinesBetweenMethods`, `importSorting`, `splitArrayOpenBracket`, `wrapLongStrings` — already safe, porting buys no correctness gain). See each pass's own comment in `formatter.ts` for its specific reasoning — the patterns below are the general lessons, not a substitute for reading the per-pass rationale.

**`stripCatchParens` has been re-ported to CST** (`cst-passes/stripCatchParens.ts`, `stripCatchParensPass`). The parser grammar added parenthesized `catch (e)` support (`parseCatchClause` in `parser.ts`), closing the "check it can actually parse first" blocker that used to apply. `CatchClause`'s children are a flat list — `[catch, LeftParen?, Identifier, RightParen?, ...body]`, no `GroupingExpression` wrapper — so the pass is a direct-token search (`findToken` for `Catch`/`LeftParen`/`Identifier`/`RightParen`) rather than a node substitution. It replaces the span from the end of `catch` to the start of the identifier with a single space (normalizes any spacing, including the no-space `catch(e)` case the old regex's mandatory `\s+` never matched) and deletes from the identifier's end through the closing paren's raw end — leaving a trailing same-line comment untouched. `paramAlignment`'s blocker (multi-line parameter lists are a genuine Roku compile error, verified against real device behavior, not a parser gap) is unchanged and still architecturally blocked — it is the only regex pass left in this category.

- **Check it can actually parse first.** A pass that exists to *repair* invalid syntax can never become a CST pass: every CST pass bails out and returns the source unchanged whenever `parseResult.diagnostics.length > 0` (`runCstPasses`/`runCstOnLines` in `formatter.ts`/`infrastructure.ts`). Two confirmed cases: `stripCatchParens` (`CatchClause` has no paren support at all, so `catch (e)` is a real parse error) and `paramAlignment` (`parseParameterList` requires every parameter on the opening paren's line *unless* a default value itself contains a multi-line AA/array/function literal — the plain wrapped-params case the pass exists to reformat produces the real error "Function parameters must be on one line"). Verify empirically with `parse(source).diagnostics` before assuming a rule is portable — don't infer it from the regex alone.
- **Not every safe-to-port pass is worth porting — check what string-literal/comment safety the regex already has for itself before assuming CST would improve it.** `alignAssignments`, `spacing`, and `indentation` are all syntax-safe already: `findSimpleAssignment` tracks strings/bracket depth itself; `spacing` splits string-literal segments out via `splitCodeSegments` before any rule runs and re-walks the assembled line with its own `inString` tracker for the AA-brace/comma rules; `indentation`'s helpers (`isDeindentLine`/`isIndentLine`, `countInlineIndentChange`, `countNetAnonFunctionOpeners`, `netContainerDepth`) all track strings and comments themselves before counting a bracket or matching a keyword. Porting any of them buys no correctness gain, only "prettier architecture" — and the cost scales with pass size: `alignAssignments` would need to handle every statement-block owner's differently-shaped child list (`SourceFile`, `FunctionDeclaration`/`Expression`, each `IfStatement` branch, `ForStatement`, `WhileStatement`, `TryStatement`/`CatchClause`, ...; see each one's `body` getter in ast.ts); `spacing` (238 lines) and `indentation` (76 lines of stateful bracket/chain/block-depth tracking, the highest blast radius of any pass since every line of every formatted file runs through it) would each mean building something closer to a second printer than an incremental rule migration. Weigh implementation cost against actual safety gain, not just "is this pass regex."
- **Not every regex pass is worth porting — check what it's actually protecting against first.** `commentWidth`/`blankLines`/`emptyLinesBetweenMethods` stay regex on purpose: they only ever touch lines already confirmed blank or comment-only (via a `trimmed.startsWith("'")`/keyword check) before writing anything, so the failure mode CST passes exist to prevent — matching inside a string literal or the wrong syntactic context — cannot occur for them. Porting these would just re-derive the same line-pattern logic from the tree for no behavioral or safety gain (`commentWidth` also doesn't fit the edit model at all: reflowing one comment across several lines means producing new trivia, not repositioning an existing token). Don't convert a pass just because it's regex; convert it because CST removes a real correctness risk.
- **`SyntaxNode.end` includes trailing trivia** (whitespace, a same-line comment, the line break) of its last token — using it as an edit's `end` position silently eats the following newline and merges two lines. Always compute the edit boundary from the actual `Token.end` (or the last token found via `walkTokens`), never from a node's own `.pos`/`.end`, when the edit needs to land exactly at a token boundary.
- **Case-insensitive regex passes that literal-replace their whole match** (e.g. the old `m.top.getField` pass had `gi` flags but replaced with a fixed-case `` `m.top.${field}` `` string) were *normalizing* casing as a side effect, not just rewriting the matched keyword. A CST port that only edits the differing suffix (and leaves the matched prefix's original source text alone) silently drops that normalization — replace the *whole* matched range, including the parts that "didn't change", when the old pass's replacement callback did.
- **A CST port can legitimately fix latent bugs in the regex it replaces**, since CST passes structurally can't match inside comments/strings and can see across line boundaries. Examples hit during this migration: (1) the old `observeFieldStyle` skipped a line entirely if the *comment* happened to mention "observeField", even when the *code* had a real call to convert; (2) the old `fieldAccessConsistency` 'method' direction would convert `m.top.count += 1` into the broken `m.top.getField("count") += 1` because its same-line lookahead couldn't tell a compound assignment from anything else `=`-adjacent. Verify these are true bugs (not intentional behavior) before "fixing" them, and call them out explicitly in the pass's doc comment and the migration's commit — don't let a silent behavior change hide inside a "pure refactor". Conversely, when the old pass's exact string-level output is pinned by existing tests for a good reason (e.g. `trailingCommas` never touching a comma after a named `function`/`sub` value in an AA — five `formatter.test.ts` tests depend on exactly this), replicate it deliberately rather than "fixing" it: the CST port's `SyntaxKind.FunctionExpression` check for array/AA item values exists specifically to reproduce that old skip, not to improve on it.
- **`ArrayLiteral`/`AALiteral` children are a flat, interleaved list** — `[LeftBracket, elementNode, Comma?, elementNode, Comma?, ..., RightBracket]` (see `parser.ts`'s `parseArrayLiteral`/`parseAALiteral`). Newlines between multi-line elements are never separate child tokens (`skipNewlines()` always returns `[]` — newlines are trivia, not significant tokens in this grammar), and a comma between elements is optional when they're separated by a real line break. Don't assume a fixed arity per item; walk the raw `children` array pairing each element node with an optional following `Comma` token.
- **A token's own `.line` field is enough to detect "is this multi-line"** — no need to inspect trivia for a `LineBreak`. Comparing `lastToken.line === closer.line` (last real token before the closing bracket vs. the closing bracket itself) is exactly the CST equivalent of the old regex's "closer must be the first non-whitespace character of its own physical line" trigger, and is what gates `trailingCommas` to only ever touch already-multi-line literals — a single-line `[1, 2, 3]` is never touched, matching old behavior exactly.
- **`IfStatement`/`ElseIfClause` both parse as `[keyword, condition, then?, ...body]`** (parser.ts `parseIfStatement`/`parseElseIfClause`) — `childNodes[0]` is always the condition, regardless of single-line-if vs. block-if or whether `then` is present. A parenthesized condition is a `GroupingExpression` node (`[LeftParen, inner, RightParen]`), so "is this condition already wrapped" is a `.kind` check, not a text-balance scan — `parenthesisIfCasePass` needed no equivalent of the old regex's `isWrappedInParens` at all, and picked up single-line-if-without-`then` for free (the old regex had to *guess* the condition boundary there and skipped whenever the guess looked risky — e.g. body containing `return` or a bare `=` — CST never needs the guess).
- **When flattening a chain of same-kind sibling nodes (a `+`-chain of `BinaryExpression`s, a `+`-connected AA/array...), guard against re-processing an inner node that's already covered by an outer one being flattened**, or you'll get overlapping edits. The working pattern (used in `stringConcatStylePass` for `+`-chains and `aaThresholdPass` for nested AAs): before flattening a node, check whether its `.parent` is the *same* kind of chain-continuation — if so, skip, an ancestor already owns it. For a node kind that recurses into arbitrary children (nested AAs), the simpler variant is: once a node is queued for its own edit, don't `visit()` into its children at all this pass — a nested match gets picked up on the *next* format run instead of racing an edit already in flight.
- **Verify an "obvious" bug before writing it into `formatter.ts` or here.** `wrapLongStrings`'s string-boundary regex looked exactly like the kind of escaping bug found elsewhere in this migration (stops at the first `"`, so a string with an embedded `""` looks mishandled) — but empirically running `formatText(..., {verifySyntax: false})` on exactly that input showed it reconstitutes correctly: splitting a string token at any position and re-quoting both sides always produces a valid escape at the seam, because two adjacent literal `"` characters are read as one escaped quote by the lexer regardless of which split-piece each one came from. The real, much smaller effect (length of the unprocessed tail isn't counted toward the wrap-width target) only became clear by testing it, not by reading the regex. A plausible-looking bug is still a claim — check it the same way as a plausible-looking fix.
- Add both a `formatter.test.ts` section (exercises the *composed* `formatText()` pipeline like the old pass did) and a `cst-passes.test.ts` section (exercises the exported pass function directly, including edge cases the top-level tests don't bother with — case-insensitivity, comment interactions, non-identifier content). The direct tests catch position-math bugs (like the trailing-trivia one above) that the composed tests can mask if the corruption happens to still produce parseable-looking output.
- **Reordering AA/array members (`associativeArraySort.ts`'s key-sort + Kopytko-template-structuring pass) cannot use a member's own trivia-inclusive `.end` as its span boundary, only its trivia-inclusive `.pos`.** A member's leading trivia is correctly its own (a comment directly above a field belongs to that field and must move with it), but trailing trivia extends up to *whatever token comes next* — for the last member in the original AA that's the closing `}`, so its trivia-inclusive `.end` wrongly absorbs the whitespace between it and `}`. Reordering with that boundary produced `{ a: 1 , b: 2}` instead of `{ a: 1, b: 2 }` (space migrated to the wrong side of the comma, no space before `}`) the first time this was written — caught by a same-line before/after test, not by inspection. Fix: use `rawEnd()` (trivia-*exclusive*) for a member's end. Separately, a comma is not a property of the member it follows — it's a positional separator indifferent to which members end up adjacent — so the pass captures `source.slice(members[i].end, members[i+1].pos)` for each of the original `n-1` gaps once and reuses that same ordered separator list between the *reordered* members, rather than trying to pair each member with "its" comma (which breaks the moment the item that used to be last, with no trailing comma, ends up in the middle of the new order).
- **XML `<interface>` sorting needed a purpose-built, byte-span-aware tokenizer (`tokenizeXmlInterfaceElements`, now in `packages/brightscript-parser/src/xml/sceneGraphQueries.ts`).** No general XML parser was needed either: SceneGraph `<interface>` children are always empty/self-closing `<field>`/`<function>` elements per Roku's docs (no nesting, no text content), so a tokenizer scoped to exactly that shape is sufficient. This lives in the parser package (not `packages/formatter`) per the "would another tool need this?" rule — but `kopytko-formatter`'s dependency on `kopytko-brightscript-parser` is a real pinned npm semver version, not a workspace link, so a new parser export needs a parser publish + formatter dependency bump before it ships for real (`npm link`/a packed tarball is enough for local dev — see `docs/publishing.md`'s publishing order). Formatting the XML itself is registered **client-side only** (`src/client/activation/xmlFormatting.ts`, `vscode.languages.registerDocumentFormattingEditProvider`), deliberately bypassing the language server — the LSP client's static `documentSelector` is `.brs`-only, and a dynamically-registered server-side XML capability (the `typeHierarchyProvider` pattern) would only ever see last-saved-to-disk content, since the client only syncs documents matching that static selector; applying edits computed against stale disk text to a live, unsaved buffer risks corrupting it. A client-side provider reads `document.getText()` directly, sidestepping the sync problem entirely with no LSP protocol changes at all.
  > **Update:** `packages/brightscript-parser/src/utils/xmlParsing.ts` (the read-only/regex `parseXmlInterface` referenced above) no longer exists — a full lossless SceneGraph XML CST (`src/xml/`: lexer, parser, typed AST) replaced it, and `tokenizeXmlInterfaceElements` was rebuilt on top of that CST rather than staying its own standalone tokenizer. Byte-for-byte behavior (including this pass's edit-based reordering) is pinned by the existing tests, which passed unchanged through the migration. See the new section below for the full sweep.

---

## Regex → CST/AST sweep — parser, server providers, linter

A repo-wide pass migrated the remaining regex-based code onto the parser's CST/AST, added a
SceneGraph XML CST, and hardened the parser's own error recovery. What's non-obvious enough to be
worth recording here (the full plan and per-task rationale is not preserved elsewhere — this is it):

- **Missing-token synthesis, not "return the unconsumed token."** `parser.ts`'s `expect()` used to
  record a diagnostic and return the *current* token without advancing past it — the caller then
  attached that same `Token` object into the tree, so a syntax error like `function 123()` produced
  the token's text 4× over in `getText()`. Round-trip tests only ever used truncated input, which
  never reached this path, so it went unnoticed. Fixed by synthesizing a zero-width `isMissing: true`
  token (`pos === end`, empty text) instead of re-attaching the real one. If you add a new `expect()`
  call site, verify round-trip text on *malformed*, not just truncated, input.
- **A parser being "error-tolerant" (always produces a tree) does not mean a bad construct's tokens
  land where you'd expect.** `return x,` — an unexpected trailing comma — cannot be attached to the
  `ReturnStatement` node (the grammar has nowhere to put it), so it surfaces as an `ErrorNode` in the
  *next sibling slot* instead. A rule/query that only inspects a node's own last child token (e.g. the
  original `checkTrailingCommaAst` in the linter) silently misses this — the single most common real
  case. Fix pattern: after finding the node, get `node.syntax.parent`, find the node's index among
  `parent.childNodes`, and check whether the *next* sibling's first token is the thing you expected —
  don't assume "attached to this node" is the only place a nearby token can end up. Same lesson
  applies to any other "X immediately follows Y" check written against the CST.
- **The dominant LSP-provider pattern for "where is the cursor" is "nearest preceding token, then walk
  `.parent`," not `findNodeAtPosition`.** Providers are almost always invoked mid-typing — an unclosed
  call, a dot-access with nothing after the dot yet — where the cursor position doesn't structurally
  exist as a token/trivia match, so `findNodeAtPosition` (root-to-deepest, containment-verified) finds
  nothing. `Token.parent`/`SyntaxNode.parent` back-references (added to support this) turn "find the
  enclosing X" into an O(depth) walk instead of a fresh O(n) tree search. Every rewritten provider
  (signature help, completion contexts, receiver-context resolution) converged on this same shape —
  it's the one to reach for first, not `findNodeAtPosition`, whenever a provider needs "what construct
  is the user currently inside."
- **A cache that reads through `lintContext.readFile`/`fsWrapper.readFileSync` must not trust that a
  "successful" read returned a string.** Real `fs.readFileSync` always either returns a string or
  throws — but a bare `sinon.stub()` with no matching `.withArgs()` returns `undefined` instead of
  throwing, and the old code in `packages/linter/src/rules/ast` happened to survive that only because
  a *different* bug (an accidental catch-all `try/catch` around a whole block) swallowed the resulting
  crash. Once that surrounding try/catch was removed as part of a narrower fix, `getCachedFunctionDefs`
  started throwing `TypeError: Cannot read properties of undefined` from inside the parser's tokenizer.
  Fixed by having `fileParseCache.ts`'s `ensureRecord` treat a non-string "successful" read the same as
  a thrown one (`typeof text !== 'string' → return undefined`) — defend the cache's own contract,
  don't rely on whatever accidentally protected it before.
- **Verify a claimed regex bug reproduces before migrating a hot-path caller off it.** The stated
  justification for migrating `packages/linter/src/analysis/functionIndex.ts`'s `parseFunctionDefs`
  to a CST walk was "a commented-out function still gets indexed as real" — but `' function foo()`
  does not match `/^\s*(?:function|sub)\s+(\w+)\s*\(/i` (the leading `'` blocks `^\s*` from ever
  reaching `function`), confirmed by actually running the regex, not by reading it. `parseFunctionDefs`
  is called once per file across the *entire* project + package dependency graph during workspace
  indexing (`projectIndexer.ts`) — a real, unconditional cost with no reproducing bug to justify it —
  so it stayed a line-scan. `parseInnerMethodDefs` (AA-method detection, same file) *did* migrate: it
  has no internal caller at all (pure public API), so the migration cost nothing, even though its own
  most interesting claimed win (detecting a nested receiver like `m.handlers.onClick = function()`)
  turned out not to hold either — `analyzeContext()`'s `dotAssignedFunctions` has the identical
  single-identifier-receiver limitation as the regex it replaced (`contextAnalysis.ts`, `obj instanceof
  IdentifierExpression`), which is now a pinned regression test rather than a silent gap. Two lessons
  in one: measure the actual regex before deciding it's broken, and verify a *replacement's* claimed
  improvement the same way you'd verify the original bug.
- **SceneGraph XML now has a real lossless CST** (`packages/brightscript-parser/src/xml/`: lexer →
  `XmlToken`/`XmlTrivia` → parser → `XmlSyntaxNode` → typed AST `XmlDocument`/`XmlElement`/
  `XmlAttribute` → `sceneGraphQueries.ts`), mirroring the BrightScript lexer/parser's own design
  (missing-token synthesis on error, ErrorNode panic-mode recovery, byte-accurate spans). It replaced
  three independently-drifted regex implementations: the extension's old `xmlScriptParser.ts`, the
  linter's old `analysis/xmlParser.ts`, and the parser package's own `utils/xmlParsing.ts`. All three
  call sites now import the same functions (`parseXmlScriptUris`, `parseXmlInterface`, `parseXmlExtends`,
  `parseXmlComponentName`, `parseComponentTag`) from `kopytko-brightscript-parser`, fixing the same
  latent bugs everywhere at once: single-quoted `uri='...'` (previously only matched by some of the
  three copies), and a commented-out `<field id="ghost"/>` no longer reported as real (comments are
  CST trivia, structurally invisible to a query, where every regex copy had zero comment awareness).
  Filesystem-dependent code (`resolveScriptUri`, `findComponentXml`'s recursive directory walk) stays
  local to each consumer — the parser package owns per-file structural facts only, never disk I/O,
  same rule as `kopytko-roku-device` staying Kopytko-ecosystem-unaware.
- **`packages/linter/src/rules/ast/*.ts` is now fully split — no more `legacyRules.ts` monolith.**
  Each of the 21 rules lives in its own file (`unreachableCode.ts` was the pre-existing template), and
  each file duplicates its own tiny local `collectAst()` helper rather than importing a shared one —
  deliberate, to keep every rule file genuinely self-contained with zero cross-file coupling. When
  adding a new AST rule, copy the shape of the smallest existing file that's structurally similar
  (e.g. `createObjectArgs.ts` for a single-visitor rule, `imports.ts` for one with several private
  helpers) rather than reaching into another rule's file for a helper.

---

## BrightScript built-ins catalog

**File:** `packages/brightscript-parser/src/catalog/builtins.ts`

Each entry: `name`, `signature`, `returnType`, `description`, `category`. Add corresponding test assertions in the builtins tests.

---

## Component catalog

**File:** `packages/brightscript-parser/src/catalog/components.ts`

- Set `since` for new methods, `deprecated: true` for removed ones
- Update `CATALOG_LAST_VERIFIED` **only** after verifying against live Roku docs
- Update `docs/brightscript-components.md` + matching component catalog tests

**Editing `packages/brightscript-parser/src/catalog/components.ts` does not affect the extension
until republished** — the root `test/brightscript/components.test.ts` and the language server both
consume the *published* `kopytko-brightscript-parser` npm dependency pinned in the root
`package.json`, not the local package source (same rule as the rest of `packages/*`, see the root
CLAUDE.md). A catalog edit is invisible to `npm test`/F5 until the package is version-bumped and
published and the extension's dependency is bumped to match.

### RokuOS 15.2 review (2026-07-31) — two items deliberately deferred

Cross-checked the [15.2 release notes](https://developer.roku.com/dev/docs/release-notes#roku-os-152)
against the catalog. `roAppMemoryMonitor`'s multi-threshold description and `ifUtils.HasComponent`
were already present (the latter had the wrong name in `docs/brightscript-components.md` — fixed).
Two items are confirmed **missing but not added**, because Roku's own interface reference pages
(`ifevpcipher.md`, `ifremoteinfo.md`) had not been updated with real signatures yet as of this date —
only release-notes prose existed ("new **setTag** and **getTag** functions", "functions for querying
... remote repeat settings"), no parameter/return types or exact method names:

- `roEVPCipher` — `SetTag`/`GetTag` for AES-GCM authenticated encryption
- `roDeviceInfo`/`ifRemoteInfo` — remote-control repeat delay/rate query functions (EN 301 549
  accessibility)

Per the rule above (never write catalog entries from memory), do not guess these signatures. Re-check
`ifevpcipher.md`/`ifremoteinfo.md` on a future pass and add them once real signatures are published.

### ⛔ Never write catalog entries from memory

`ifDateTime` shipped **seven fabricated method names** and one method that does not exist at all:

| We had | Reality |
|---|---|
| `AsLongMilliseconds` | `AsMillisecondsLong` |
| `AsLongSeconds` | `AsSecondsLong` |
| `FromLongSeconds` | `FromSecondsLong` |
| `GetISOString` | `ToISOString` |
| `GetISOStringWithMilliseconds(fmt)` | `ToISOString(fmt)` overload |
| `GetLocalDateTime` / `GetLocalTime` | `asDateStringLoc` / `asTimeStringLoc` |
| `GetDayOfYear` | does not exist |

**Why it is easy to get wrong: Roku's own naming is inconsistent.** `ifDateTime` uses a trailing
`Long` (`AsMillisecondsLong`) while `ifDeviceInfo` uses `AsLong` (`GetUptimeMillisecondsAsLong`) —
both verified live. Generalising either convention to the other interface produces a plausible name
that does not exist, and a wrong completion is worse than a missing one because the user trusts it.

Two more traps seen on the real pages: Roku documents `AsSecondsLong` as returning **`Object`** and
`AsMillisecondsLong` as **`Long`** (neither is a BrightScript type keyword — the catalog uses
`LongInteger` and notes the discrepancy in the description), and it writes `asDateStringLoc` /
`asTimeStringLoc` with a **lowercase first letter** while every sibling is PascalCase. Match the
documented casing — there is precedent (the 16 `e*` socket status methods).

**Always fetch the interface's page before editing its entry**, and pin the result with a test that
compares `getComponentMethods()` against the documented list (see the tests in
`packages/brightscript-parser/test/analysis.test.ts`).

### Full audit result (2026-07-28)

All 80 interfaces were diffed against their live docs pages. **21 were wrong** — 51 methods removed,
14 added, method total 691 → 654. Three distinct failure modes, which need different fixes:

1. **Fabricated** — the name is on no Roku page (`GetFirmwareVersion`, `ToUpper`, `MoveFile`,
   `GetChildByName`, `GetExtension`, …). Delete.
2. **Misfiled** — real, but documented on a different interface the same component implements.
   `IsEmpty` sat on `ifStringOps` (really `ifString`), `Count` on `ifXMLList` (really `ifArray`),
   and eight `ifHttpAgent` header/cookie methods were copied into `ifUrlTransfer` while
   `roUrlTransfer` did not even list `ifHttpAgent`. **Fix by correcting the component's `interfaces`
   array, not by deleting the method** — otherwise completions disappear.
3. **Missing** — documented but absent (`TotalMicroseconds`, `getGlobalNode`, `ShrinkToFit`, …).

**`ifSGNode` is synthetic.** Roku has no such interface — `roSGNode` implements `ifSGNodeChildren`,
`ifSGNodeField`, `ifSGNodeDict`, `ifSGNodeFocus`, `ifSGNodeBoundingRect`, and
`ifSGNodeHttpAgentAccess`. Our single 34-method aggregate works for completion but the name is ours,
not Roku's; it is the one interface the audit could not diff. Splitting it is a breaking API change.

**How to re-run the audit:** fetch each interface's page asking only for bare method names, write one
`<ifName>.txt` per interface, and diff `getComponentMethods()` against it. The one-shot doc summariser
sometimes truncates — when a name looks real, re-query that page specifically before deleting it.
That check is what caught `AddHeader` as misfiled rather than fabricated.

### Follow-up: a fourth failure mode — the wrong object entirely (2026-07-28, same day)

Two pre-existing tests in `test/brightscript/components.test.ts` and
`test/providers/completionProvider.test.ts` (written before the audit, asserting against the *old*
catalog) failed CI after the fix released: they expected `Values` on `roAssociativeArray` and
`GetResponseCode` on `roUrlTransfer`. Re-verifying both with pointed yes/no questions (not a bare
list dump) confirmed the audit's original deletions were right — but also surfaced a fourth failure
mode the sweep's fabricated/misfiled/missing taxonomy didn't cover:

4. **Wrong object.** `GetResponseCode`/`GetResponseHeaders`/`GetResponseHeadersArray` are real, but
   belong to `roUrlEvent` — the object an *async* `ifUrlTransfer` request (`AsyncGetToString`, …)
   delivers via the message port on completion, not the request object itself. The catalog had no
   `roUrlEvent` entry at all, so these methods were misfiled onto the request object because that
   was the only place completion could offer them — a plausible-looking home that happened to be
   wrong. Added `roUrlEvent`/`ifUrlEvent` (synthetic, like `ifSGNode` — Roku documents these methods
   directly on the component page with no separate interface page).

**Lesson: a hardcoded test asserting a method exists is not proof it belongs on that object.**
`Values` was genuinely fabricated (confirmed twice). `GetResponseCode` was real but on the wrong
object — request vs. response-event. When completion/catalog work touches an async API with a
paired "you get the result back on a different object" pattern (message-port events, promises,
callbacks), check which object actually documents the method before assuming the one under test is
right.

`CATALOG_LAST_VERIFIED` covers a full sweep, not a single interface — do not bump it for a
one-interface fix.

---

## Kopytko module catalog

`src/server/kopytko/moduleCatalog.ts` scans installed packages at runtime. Tests in `test/kopytko/moduleCatalog.test.ts`.
Its walk passes `walkTree(..., { skipNodeModules: false })` — every other workspace walker skips
`node_modules` to avoid descending into installed packages, but this walk's root *is* an installed
package's own base dir, so the default skip would silently make its own contents invisible.

## Directory walkers that stay separate from `dirWalker.ts`

`findComponentXml`'s two helpers in `xmlScriptParser.ts` (`findFileInTree`, `findXmlByComponentName`)
look like more copies of the same walk-and-collect pattern but are not: both are depth-limited
(`maxDepth`, since they run for every link in an `extends` chain) and **early-exit** — they check all
files at the current level before recursing into subdirectories, and return as soon as a match is
found, so a shallow match never pays for a full subtree walk. `dirWalker.ts`'s `walkTree` always visits
every file (it takes a void callback, not a predicate), so routing these through it would force a full
tree walk on every call — a real regression on a hot, repeatedly-called path. Leave them as-is unless
`walkTree` grows early-exit support.

`packages/linter/src/analysis/xmlParser.ts` carries a second, independent copy of this exact same
`findFileInTree`/`findXmlByComponentName`/`findComponentXml` pair — deliberately, not an oversight.
The linter package cannot depend on the extension's `src/server/`, and the same early-exit/depth-limit
reasoning applies there too. When one copy's walk strategy changes, check the other.

---

## Workspace component index

`src/server/utils/workspaceComponentIndex.ts` maps SceneGraph component name → declaration and parent
→ subtypes, for type hierarchy. Two things it does differently from `WorkspaceCallIndex`, both
deliberate:

- **Built from `buildSearchRoots()`, not `getWorkspaceFolders()`.** `_walkDir` skips `node_modules`
  (as every workspace walk here does), so components shipped by installed Kopytko packages would be
  invisible — `extends="KopytkoSomething"` would resolve to nothing. Passing the package base dirs in
  as explicit roots is what makes them reachable: the skip only prevents *descending into*
  `node_modules`, it does not reject a root that already lives there.
- **The name map is rebuilt from the file map on every change**, rather than patched in place. A
  renamed component otherwise lingers under its old name forever, and the reverse (subtypes) map
  would keep an entry pointing at a component that no longer extends it.
- **Roots are de-duplicated before walking** (`dedupeRoots`). `buildSearchRoots()` returns both
  `<ws>` and `<ws>/<sourceDir>`, so without this the source tree is traversed twice. File *reads*
  dedupe through `readCachedFileText`; `readdirTyped` calls do not — `_walkDir` calls it directly.

### Duplicate component names — the check lives in the linter

`component/duplicate-name` reports the same `<component name>` declared by two XML files. It cannot
fall out of any existing lookup — `findComponentXml` and the import resolver are first-match searches
that stop at the first file they find, which is precisely why a duplicate is invisible and why the bug
it causes (a component silently overridden by load order) is so hard to trace from the symptom.

**It is not a per-file rule, and it is not extension-only.** The canonical implementation is
`kopytko-linter`'s `src/analysis/duplicateComponents.ts`, a pure function over
`ComponentDeclaration[]`. `runLint` calls it once per project after the per-file pass (`kopytko-lint`
reports it at the default `warning`; raise the rule to `error` in `.kopytkolintrc` for `--check` to
fail the build on it — see the *Duplicate Component Names* section above);
`services/componentDiagnostics.ts` calls it against `WorkspaceComponentIndex` (so the editor shows it
on save). A rule cannot do this — `RuleContext` is one `.brs` file — which is why it is a project-wide
pass in `runLint` rather than an entry in `ALL_RULE_GROUPS`.

Both call sites import the check straight from `kopytko-linter` (>= 1.7.0, released alongside this
feature). There was a transitional period where the extension's dependency lagged the linter release
and `src/server/brightscript/duplicateComponents.ts` carried a byte-for-byte mirror so the extension
could ship without waiting on a publish — that file is now deleted; do not recreate it. If this ever
recurs (a linter-side check the extension needs before the next linter release), mirror in exactly one
file with a header stating the version to delete it at, and grep for the mirror's own filename before
assuming it's still needed — `git log -- <path>` shows when it was added and removed last time.

Three things this got wrong before it worked:

- **`dedupeRoots` must model reachability, not string prefixes.** Kopytko package base dirs are
  `<ws>/node_modules/<pkg>/<dir>` — a sub-path of the workspace root, but one `_walkDir` will never
  descend into. Collapsing them as "already covered" silently un-indexes every package component.
  `walkReaches()` re-applies the walker's own skip rules to the relative segments. A test that
  asserted a package component was still found is what caught it.
- **`updateFile` needs the same scope test as `build`.** The client watches `**/*.xml` across the
  whole workspace, so the watcher offers paths the build deliberately skipped (`node_modules` outside
  a package base dir, dot-directories). Indexing them on write makes the index depend on what changed
  since startup — a duplicate-name warning that vanishes on restart. `_isInScope` replays the stored
  roots through `walkReaches`. Deletions stay ungated: dropping an entry is always safe.
- **The rule defaults to `warning`, and `kopytko-lint --check` exits non-zero on errors only.** So it
  does not fail CI out of the box — that is deliberate (a mis-scoped build-output dir would flag every
  component in the project), but it means "it runs in CI" is only true for reporting/SARIF unless the
  project raises it to `error`.

- **Filter excluded paths *before* counting, not after.** A build pipeline that copies `app/` into a
  staging dir turns every component in the project into a "duplicate". The check honours
  `kopytko.lint.readOnlyPaths`, and a name whose only remaining declaration is non-excluded must not
  be reported at all. Filtering after the `length > 1` test would still warn on the surviving file.
- **Published diagnostics are sticky per URI.** `sendDiagnostics` replaces the list for a URI, so a
  resolved duplicate needs an explicit empty publish. The service tracks `_publishedUris` for exactly
  this. Note this is also the one place the server publishes diagnostics for a file that is **not** a
  synced document — which works, and is what makes reporting on XML possible at all.

---

---

## Documented counts are machine-checked

Any number in a README/docs/site page that counts something in the code (built-ins, keywords, ro*
components, interfaces, SceneGraph nodes, lint rules, formatter options, CST passes, LSP providers)
is verified by `scripts/check-doc-claims.mjs`, run from `npm run lint` and CI.

- **Adding to a catalog or rule set? Update the number too** — CI will tell you which file.
- **Rewording a sentence that contains one of these counts breaks the regex.** The check reports it
  as "pattern matched nothing" rather than passing silently; fix the pattern in the CLAIMS table.
- It loads the **TypeScript source via tsx, not `dist/`** — deliberately. The packages' `dist/` can
  be weeks stale (it was, when this was written), which is exactly how the drift went unnoticed.

---

## Key files reference

| Area | Key files |
|---|---|
| LSP entry | `src/server/server.ts`, `src/server/registerHandlers.ts` |
| Providers | `src/server/providers/` (17 providers) |
| Document cache | `src/server/utils/documentCache.ts` |
| Cache invalidation | `src/server/services/cacheInvalidation.ts` |
| Import resolution | `src/server/kopytko/importResolver.ts` |
| Directory walk (skip dot-dirs/node_modules, callback per file) | `src/server/utils/dirWalker.ts` — shared by `WorkspaceFunctionIndex`, `WorkspaceCallIndex`, `WorkspaceComponentIndex`, `KopytkoModuleCatalog` (passes `skipNodeModules: false` — its root is already inside `node_modules`, see below) |
| Built-in catalog | `packages/brightscript-parser/src/catalog/builtins.ts` |
| Component catalog | `packages/brightscript-parser/src/catalog/components.ts` |
| Formatting engine | `packages/formatter/src/formatter.ts` + `cst-passes/` |
| Test stub for fs | `src/server/utils/fsWrapper.ts` (Sinon-stubbable wrapper) |
| Test vscode mock | `test/roku/vscode-mock.ts` |
