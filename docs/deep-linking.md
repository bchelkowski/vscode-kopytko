# Deep Linking

An editor-tab tool for firing Roku **deep links** at the active device: pick an installed
channel, define a `contentId` plus any additional key-value parameters, and send them via
ECP **Launch** or **Input**. Parameter combinations can be saved as named, per-workspace
presets and reused later.

Open it with the **Deep Linking** button in the Kopytko Tools sidebar, or run
`Kopytko: Open Deep Linking` from the command palette (`kopytko.deepLinking.open`).

## Why

Every certified Roku channel must handle deep links (`contentId` + `mediaType`) both at
launch and while already running. Testing them normally means hand-crafting `curl`
commands against ECP — this panel replaces that with a form, a channel picker, and a
preset library.

## Launch vs Input

| | Launch | Input |
|---|---|---|
| ECP request | `POST /launch/{appId}?contentId=…&mediaType=…` | `POST /input?contentId=…&mediaType=…` |
| Channel state | Starts the channel, or **relaunches** it if running | Requires the channel to already be running in the **foreground** |
| Delivery | Launch arguments (`main(args)` / `roSGScreen` launch params) | `roInput` event — no relaunch, no interruption |
| Target | The channel selected in the panel | Always the foreground channel (ECP `/input` has no app-id parameter) |

The Input button is never disabled based on channel state — whether the selected channel
is currently the foreground app isn't reliably detectable for non-dev channels, so the
panel explains the semantics instead of gating the action.

## The panel

- **Channels** — every installed channel from `GET /query/apps`, with icons fetched via
  `GET /query/icon/{appId}` (a placeholder is shown if an icon fails to load). Click to
  select; the sideloaded dev channel appears as id `dev`. **Refresh** re-queries the device.
- **Deep Link form** — `contentId` field plus free-form key/value parameter rows. The key
  input suggests `mediaType`; when the key is `mediaType`, the value input suggests Roku's
  known values: `episode`, `live`, `movie`, `season`, `series`, `short-form`, `special`.
  All keys and values are URL-encoded automatically. Blank keys are skipped; a blank
  `contentId` is omitted from the request.
- **Saved Parameter Sets** — name the current form and **Save**. Each set stores the
  channel, `contentId`, parameters, and an optional list of custom labels (comma-separated,
  with autocomplete from labels already used in the list — picking a suggestion appends it
  after the last comma rather than replacing what's already typed). **Use** loads a set into
  the form (with a warning if its channel is no longer installed on the current device),
  **Edit** additionally prefills the name and labels so Save becomes Update, **✕** deletes.
  Sets are persisted in the workspace state — each project keeps its own library. A **Filter**
  dropdown (checkboxes, default all checked, with "All"/"Clear" shortcuts, closes when you
  click outside it) and a **Sort** dropdown (Title by default, or a specific label to bring
  matching sets to the top) narrow and order the list; both reset when the panel reloads.

The panel follows the active device from the Roku Devices view and reloads channels when
it changes. With no active device it shows an empty state instead of the channel grid.

## Requirements & errors

- ECP needs no password, but the device setting **Settings → System → Advanced system
  settings → Control by mobile apps** must be *Enabled* — in "Limited" mode the device
  answers `403` and the panel surfaces the device's response message.
- A `404` from Launch means the channel id isn't installed.
- Device-unreachable errors show up in the error banner; use **Refresh** after the device
  comes back.

## Implementation notes

- ECP methods live in the `kopytko-roku-device` package: `EcpClient.launchApp()`,
  `EcpClient.sendInput()`, `EcpClient.queryAppIcon()` (binary-safe fetch), helper
  `buildEcpQueryString()`.
- Extension side: `src/client/deepLinking/` — `ParameterSetStore` (workspaceState
  Memento), `DeepLinkingController` (device/ECP/store logic, no VS Code UI),
  `DeepLinkingPanel` (singleton `WebviewPanel`), webview under
  `src/client/deepLinking/webview/` (bundled to `out/deep-linking-webview/`).
- Icons are transferred to the webview as `data:` URIs, so the webview CSP never needs to
  allow `http:` image sources.
