# Device Manager architecture notes

## Roku Devices tree: `-online` and `-active` contextValue segments are independent

`DeviceTreeItem.buildContextValue()` (`src/client/roku/views/deviceTreeItems.ts:43-49`)
builds `contextValue` from independent optional segments: `-favorite`, `-online`,
`-active`. Being the **active** device does not imply `-online` — a device can be
set active while its `DeviceState` (`packages/roku-device/src/types.ts:1`) is
`unknown`/`pending`/`offline` (the `selectDevice` `when` clause has no online
requirement, and health checks are async/cached for 5 min, so a just-selected or
just-launched device commonly lags behind reality). Any `package.json`
`view/item/context` `when` clause gating a button on `-online` alone will hide
that button for an active-but-not-yet-confirmed-online device. Upload/Debug were
fixed to match on `-online || -active` (`package.json`, `kopytko.uploadToDevice`/
`kopytko.debugDevice` entries) since their command handlers
(`src/client/activation/commands.ts:156-232`) already surface a clear error if
the device turns out unreachable — showing the button and letting the action
fail is better UX than hiding it on a state flag that can be stale. Before adding
a new device-row button gated on device state, check whether it should also fire
for the active device regardless of confirmed online-ness.

## Merging sidebar views without losing user layout state

VS Code remembers per-view-id state (position, pinned/unpinned, collapsed/expanded)
keyed by the `id` in `contributes.views`. When merging several views into one
(Remote Control absorbed the former `savedText` and `abilities` views), keep the
surviving view's **existing id** rather than introducing a new one — dropping the
other ids from `package.json` silently forgets their state (fine, they no longer
exist), but reusing the survivor's id means existing users don't lose their
sidebar drag-to-Secondary-Side-Bar position. See `docs/device-manager.md` for the
current two-view layout (Remote Control, Scripts).

## `DeviceManagerViewProvider` kind vs. message kind

`onMessage()` in `views/deviceManagerViewProvider.ts` dispatches purely on
`msg.kind` (`'ability'`, `'saveEntry'`, etc.), never on `this.kind` (which view
sent it). That meant merging three view "kinds" into one (`'remote'` now also
handles what `'entries'`/`'abilities'` used to) required **no changes to
`onMessage()`** — only `sendAll()` (which decides what to push on `ready`/
visibility) and the webview's own dispatch (`viewKind === ...` guards in
`webview/main.ts`) needed updating. Worth checking this split before assuming a
merge touches more than it does.

## Removing an `AbilityAction` cascades to an unused controller dependency

Dropping `deviceInfo`/`activeApp` from `AbilityAction` also made `AbilitiesController`'s
`ecp: EcpClient` dependency dead code — it was only used by those two methods
(`queryDeviceInfo`/`queryActiveApp`), not by any of the web-admin methods (those go
through `InstallerClient`, injected separately). Removing an action isn't just
deleting the webview button + `abilityActions.ts` switch case — check whether the
controller method it called was the last user of one of its constructor deps.

## Device actions: from icon-only pills (`.ability-btn`) to labeled rows (`.device-action`)

Device actions started as icon-only pill buttons visually matching the
remote keypad (`.remote-btn`) — circular, `--roku-purple`, label only in the
`title` tooltip. Users didn't discover the section or understand the icons,
so it was redesigned to `.device-action`: full-width rows with a small
purple icon chip (`.action-icon`, still `--roku-purple`) plus a **visible**
label and one-line description (`.action-label`/`.action-desc`). Danger
actions (restart, delete channel, reset & update, clear cache) keep the red
`outline` (via `--vscode-errorForeground`) rather than a different button
family — same "still signals destructive intent without changing shape"
approach as before.

Naming gotcha if you touch this again: `.action-row` was already taken by
an unrelated flex-wrapper class used for the Scripts list's button row and
the entry-form's button row (`webview/main.ts`/`styles.css`) — reusing that
name for the device-action buttons silently broke both, since CSS doesn't
care that they're semantically different (`<div>` wrapper vs `<button>`).
The device-action buttons are named `.device-action` specifically to avoid
this collision; grep for a class name before introducing a new one in this
webview.

The `--roku-purple` custom properties are scoped to `body` (not `#remote`)
specifically so both `.remote-btn` and `.action-icon` — which live in
different, non-nested parts of the DOM — can share one source of truth
(`src/client/deviceManager/webview/styles.css`).

Saved Text was later made collapsible too (`<details id="saved-text">`,
matching `#device-actions`) and moved **above** Device actions — both are
now `.section-disclosure`, a shared class factored out of what used to be
`#device-actions`-only rules, so a third collapsible section can reuse it
without re-deriving the chevron/summary styling. Both default to `open`:
collapsed-by-default was the original discoverability problem with Device
actions, so neither top-level section repeats it.

## Custom labels: normalize host-side, duplicate parsing per webview bundle

Added free-form `labels: string[]` to `TextEntry`, `DeviceScript`, and
`DeepLinkParameterSet`. The trim/dedupe/case-fold normalization policy lives in
one place — `src/client/textLabels.ts` (`normalizeLabels`) — and is imported by
all three extension-host stores, since stores all run in the Node/extension-host
bundle and can share code freely. The **webviews cannot** import it: each of
`deviceManager/webview/main.ts`, `deviceManager/editorWebview/main.ts`, and
`deepLinking/webview/main.ts` is bundled separately by esbuild with no shared
module graph between them (same reason the `visibilityDropdown`-style filter/sort
helpers are hand-duplicated across all three files rather than factored out) — so
each webview carries its own small local `parseLabels()`/`labelKey()` doing the
same split/trim/dedupe. If a fourth label-bearing list is added, duplicate again
rather than reaching for a shared webview import — there's no build wiring for it.

Filter/sort state (`checkedLabels: Set<string> | undefined`, `sortLabel: string`)
is deliberately transient, module-level `let` in each webview — matches how these
views already fully re-render from scratch on `ready`/visibility with no state
persisted to Memento. Store-level `getAll()` sorting was left untouched
(alphabetical by title/name); label-aware sort/filter is pure client-side logic
over the array already pushed down, applied just before each render call.

Two gotchas hit while iterating on this feature, worth remembering for any
future `<details class="dropdown">` + `<select>` toolbar pair, or any
`<input list="...">` autocomplete field:

- **`<select>` and `<details><summary>` don't share a rendering box model**,
  even with identical padding/font-size — native `<select>` chrome (the
  built-in arrow, OS-level vertical centering) doesn't line up with a plain
  `<summary>`'s box the way you'd expect from matching CSS alone. The fix that
  actually produces pixel-identical boxes is an explicit `height` (22px here)
  plus `line-height` sized to `height - 2*border`, `padding: 0 <horizontal>`,
  and `box-sizing: border-box` on *both* elements — matching padding/font-size
  alone is not enough.
- **`<input list="...">` (datalist) replaces the entire field value when a
  suggestion is picked**, not just the word being typed — there's no native
  "insert at cursor" or "complete current segment" behavior for datalists.
  For a comma-separated multi-value field this destroys whatever was already
  typed. The fix (`wireLabelsAutocomplete()` in `deviceManager/webview/main.ts`
  and `deepLinking/webview/main.ts`) detects the pick via the `input` event's
  `inputType === 'insertReplacementText'` (fires specifically for datalist
  selection in Chromium, which is what VS Code webviews run), then
  reconstructs the value as `<everything before the last comma>, <picked>, `
  instead of accepting the browser's whole-value replacement.

## Secret screens: from auto-press to reference-only

Roku's undocumented secret screens (enable dev mode, channel info,
screenshots & ads, reset & update, clear cache — each triggered by a canned
remote-control key sequence starting with several `Home` presses) were
originally built as a second class of Device action, auto-sent via ECP
(`DeviceManagerController.pressKeySequence()`, a `KeySequenceAction` type
parallel to `AbilityAction`, dispatched through its own `WebMsg` kind). That
code has since been **removed entirely** — see history if you need the
implementation details. What's shipped now instead: `SECRET_SCREENS` in
`webview/main.ts` is a **plain read-only list** (label + key sequence text +
description, rendered as `<div>` rows, not `<button>`s) inside its own
`#secret-screens` disclosure (`.section-disclosure`, same shared style as
Saved Text / Device actions, expanded by default). No message kind, no
host-side dispatch, no `EcpClient` call — purely informational, the user
types the sequence on their own physical remote.

**Why the auto-press approach was abandoned**, in case someone's tempted to
rebuild it: testing on a real Roku Ultra found 3 of the 5 sequences
(Channel info, Reset & Update, Clear cache) *did* trigger reliably via ECP
`pressKeySequence` — ruling out a bug in the send loop or a blanket
ECP-can't-do-this limitation. But 2 of 5 (**Enable dev mode**,
**Screenshots & Ads**) never triggered via ECP under any tried condition —
not the original 700ms inter-key delay, not 150ms, not an extra leading
`Home`, not sending each key as `keydown`→wait→`keyup` instead of an atomic
`keypress` (to mimic a physical press's actual duration) — despite the
exact same key lists being reconfirmed working when entered by hand on a
physical IR/RF remote. Leading (unconfirmed) theory: Roku may deliberately
restrict ECP-simulated input from triggering the more sensitive screens
(dev mode enable is a real security boundary — silently flippable via any
app on the LAN would be bad) while allowing it for lower-stakes ones. Even
setting that aside, the user's own call: a device/firmware-specific secret
sequence that happens to work via ECP on one test device today isn't
something to build a "does this for you" button around — it's exactly the
kind of thing that could silently stop working on another model or after
an OS update, with no way for the extension to detect that it failed. A
reference list degrades gracefully (worst case, a description is stale);
an auto-press button that silently no-ops does not.

Confirmed key sequences and what they actually do — worth keeping accurate
if these ever get re-documented elsewhere: the original assumption that
`Home×5, Up, Rev×2, Fwd×2` clears the device *registry* was wrong; it
clears temporary system caches and forces a hard reboot (device hangs
~1 minute on a Roku Ultra) — that's **Clear cache**, not a registry clear.
The real registry-wipe path is **Reset & Update** (`Home×5, Fwd×3, Rev×2`),
which opens a diagnostic panel offering Factory Reset (wipes the registry)
or Soft Reset/Update — the reference list only shows the sequence that
opens the panel, same as before; the user picks the option on-device.
**Enable dev mode** (`Home×3, Up×2, Right, Left, Right, Left, Right`) is
sourced from Roku's own
[developer-setup docs](https://developer.roku.com/dev/docs/developer-setup)
rather than guessed, but has still never been confirmed to open the
Developer Application Installer screen via this extension (only by hand) —
don't assume it's settled without a fresh device check.

If a future task wants to try auto-pressing these again, re-read this
entry first — the specific combinations already ruled out (delay tuning,
leading `Home`, hold-vs-click) shouldn't be re-tried without new evidence,
per the project's no-speculative-device-protocol-changes rule.

The Saved Text implicit `type` facet (`text`/`credentials`) is presented as
its own **"Type"** heading in the Filter checkbox list and a `<optgroup
label="Type">` in the Sort `<select>`, separate from a **"Labels"** heading/
group for custom tags — both built by `renderFilterSortToolbar()`'s
`LabelGroup[]` parameter (`{ heading?, labels }[]`). Scripts and Deep Link
sets have no implicit facet, so they pass a single unheaded group. This
replaced an earlier version that flattened `type` into the same list as
custom labels (indistinguishable "text"/"credentials" checkboxes mixed in
with user tags) — the grouped version was requested after that flat version
shipped, so prefer grouping by heading over flattening if a future list gains
its own implicit facet.
