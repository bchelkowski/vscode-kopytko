# Device Manager architecture notes

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
