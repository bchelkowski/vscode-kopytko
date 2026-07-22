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

## `.remote-btn` reused for `.ability-btn` (icon-only pill buttons)

Device actions buttons were restyled to visually match the remote keypad
(`.remote-btn`): circular pill, same `--roku-purple` palette, icon-only with the
label in the `title` tooltip instead of visible text. The purple palette
variables were originally scoped to `#remote { --roku-purple: ...; }` — since
`.ability-btn` lives in a sibling `<details>` block, not a descendant of `#remote`,
those custom properties weren't in scope there. Moved them to `body` so both
button families share one source of truth (`src/client/deviceManager/webview/styles.css`).
Danger actions (reboot, deleteChannel) keep the same pill shape/background but add
a red `outline` (via `--vscode-errorForeground`) rather than changing to a
different button family — keeps the "matches the remote" promise intact while
still signaling destructive intent.

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
