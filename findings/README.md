# findings/ — internal knowledge base

What we learned the hard way, written for whoever works here next. Not user documentation —
that is `docs/`.

## Read this before starting

| Working on | Read |
|---|---|
| Any Roku device communication (ports, commands, response formats) | [roku-device-api.md](roku-device-api.md) |
| `src/client/diagnostics/`, or **any webview** (toolbars, uPlot, xterm, sidebar vs panel) | [diagnostics-panel-architecture.md](diagnostics-panel-architecture.md) |
| `src/client/network/` — proxy, redirect, rewrite rules | [network-inspector.md](network-inspector.md) |
| LSP providers, formatter rules, built-in/component catalogs | [lsp-architecture.md](lsp-architecture.md) |
| Build, test, compile, F5 debug | [dev-environment.md](dev-environment.md) |
| `src/client/deviceManager/` — remote, RASP, abilities | [device-manager-architecture.md](device-manager-architecture.md) |
| Roku Pay Web Services | [roku-pay-api.md](roku-pay-api.md) |

Locating code is a different question — use [MAP.md](../MAP.md).

## archive/

`archive/*-journal.md` holds the original chronological session journals. They are **not read by
default** and are not kept current: they contain reverted features and conclusions later disproven.

Go there only to answer *"why was this tried and why did it fail?"* — for instance before revisiting
the macOS single-prompt redirect, or when you need a full raw device response that the reference
files only summarise. The reference file is the current truth; the archive is the paper trail.

## Writing rules

These exist because the three big files reached 1907, 1224, and 1008 lines of append-only journal
before being split — at which point reading one cost more than the task it was meant to help with.

1. **Update the reference file in place.** Replace what your finding supersedes; do not append a
   dated entry describing the change. If the file now contradicts itself, you appended.
2. **No dates in reference files.** Dates belong in `archive/`. The exception is a
   live-verification marker (firmware, device model, capture date) — that is evidence, not history.
3. **Append to `archive/` only when the story of a failure is worth keeping** — a wrong theory that
   looked right, an approach that must not be retried. Then put the one-line rule in the reference
   file's **⛔ Never do this** section, because that is the part anyone will actually read.
4. **Keep the *why*.** One clause is enough, but it must survive. A rule with no reason gets
   "cleaned up" by the next person who finds it inconvenient.
5. **Mark unverified claims ⚠️.** A docs-derived shape is a hypothesis, not a fact. Every expensive
   bug in `roku-device-api.md` came from treating one as the other.
6. **Split or prune past ~250 lines.**

## Compression style

Reference files are read on nearly every task, so density is a feature:

- **Answer first.** Do not restate the problem before the finding.
- **Tables over prose** for anything enumerable.
- **Imperative mood** — "Use X. Never Y." not "It was found that using X…".
- **Do not inflate bold.** One file had 169 bold spans; when everything is emphasised nothing is.
- **This does not apply to `docs/` or `site/`.** Those are read by humans evaluating the extension.
  Terseness there is a downgrade, not a saving.
