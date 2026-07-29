# Device Manager

A dedicated Activity Bar container (`Kopytko Device Manager`) bundling everything
needed to drive a Roku device by hand or by script, across two sidebar views:

- **Remote Control** — the on-screen remote, then three collapsible
  disclosures (all expanded by default): **Saved Text** entries (including
  credentials), **Device actions**, then **Secret screens** (a reference
  list of remote key sequences — not buttons; see below).
- **Scripts** — a **RASP script** library with an editor tab and runner.

All views target the **active device** selected in the Roku Devices view and
react live to device changes.

> **Tip — right-hand sidebar:** VS Code extensions cannot place views in the
> Secondary Side Bar directly, but you can drag the Kopytko Device Manager icon
> from the Activity Bar onto the right-hand sidebar once and VS Code remembers
> the position. A one-time hint notification says the same when the Remote
> Control view first opens.

Open it from the Activity Bar icon, the Tools sidebar button, or
`Kopytko: Open Device Manager`.

---

## Remote Control view

An on-screen remote that mirrors the official [Roku Remote Tool](https://developer.roku.com/dev/docs/roku-remote-tool)
keypad — purple pill buttons in six rows: Back + Home, a directional pad
(Up / Left–OK–Right / Down), Instant Replay + Options (`*`), and
Rev / Play / Fwd. No app-shortcut, volume, or power buttons; the Roku-TV-only
volume keys are still reachable through keyboard remote mode
(`Ctrl+↑` / `Ctrl+↓` / `Ctrl+M`) and in scripts.

### Press-and-hold

Every button implements ECP's three key commands:

- **Click (released under the threshold)** → `POST /keypress/{key}` — a single
  press-and-release.
- **Hold (≥ threshold, default 1 s)** → `POST /keydown/{key}` when the
  threshold elapses, then `POST /keyup/{key}` on release — the device treats
  the key as held the whole time (e.g. hold Right to scrub).

The threshold is `kopytko.deviceManager.holdThresholdMs`. If the view is
disposed mid-hold, the extension sends a safety `keyup` so the device is never
left with a stuck key.

### Text input

The field under the buttons types free text on the device's on-screen keyboard
(Enter or **Send**). Characters are sent as `keypress/Lit_<char>` — one per
Unicode code point, URL-encoded UTF-8 for non-ASCII (`€` → `Lit_%E2%82%AC`) —
and each request is **awaited before the next one is sent**, so characters
always arrive in order.

### Keyboard remote mode

The **Keyboard remote mode** toggle (also `Kopytko: Toggle Remote Control
Keyboard Mode`) lets the physical keyboard drive the device:

| Key | Device key | | Key | Device key |
|---|---|---|---|---|
| `↑` `↓` `←` `→` | Up / Down / Left / Right | | `Ctrl+Enter` | Play |
| `Enter` | Select (OK) | | `Ctrl+←` / `Ctrl+→` | Rev / Fwd |
| `Escape` | Back | | `Ctrl+Backspace` | Instant Replay |
| `Backspace` | Backspace | | `Ctrl+8` | Options (`*`) |
| `Home` | Home | | `Ctrl+↑` / `Ctrl+↓` / `Ctrl+M` | Volume up / down / mute |
| | | | `Ctrl+K` | Exit remote mode |

(macOS: `Cmd` instead of `Ctrl`.)

While the mode is on:

- The keys above work **from anywhere in VS Code** — they are ordinary
  extension keybindings gated on the `kopytko.deviceManager.remoteMode`
  context, so they deliberately steal arrows/Enter/Escape from the editor
  (same trade-off as Roku's own remote tool). A warning-colored
  **`$(broadcast)` Roku Remote** status-bar item is the always-visible
  indicator; click it (or `Ctrl+K`) to exit.
- **Typing printable characters works whenever focus is anywhere inside the
  Remote Control view** — the view background, a remote button, or the toggle
  checkbox; the mode grabs focus on activation so typing works immediately.
  The one exception is the Send text field, whose typing stays local (it has
  its own buffered-send purpose). Only printable characters are captured in
  the webview: VS Code re-dispatches webview keyboard events to the
  workbench, so the navigation keybindings above fire even with the view
  focused, and handling them in the webview too would double-send every key.

Design note: the `type`-command override (used by some extensions to capture
editor typing) was rejected on purpose — only one extension per window can
register it (VSCodeVim and rokucommunity's BrightScript extension already do,
and both are likely co-installed), and it only fires while a text editor has
focus anyway.

## Saved Text section

Part of the Remote Control view, right below the remote — a `<details>`
disclosure ("▾ Saved Text"), **expanded by default**. Reusable entries for
text you type on devices often — search terms, deep-link IDs, and
test-account credentials:

- **Text** entries hold one string and one **Send** button.
- **Credentials** entries hold an email/login and a password — two independent
  **Send** buttons, so a login screen is two clicks (plus navigating between
  the fields on-device).
- Every entry has an optional title for the list — entries without one show
  their labels (see below) in the title's place instead of an empty space.

Entries are stored **globally** (they follow you across workspaces).
**Passwords never touch the Memento** — they live in VS Code SecretStorage
(the OS keychain), keyed per entry (`kopytko.deviceManager.entry.<id>`), the
same mechanism as device passwords. The webview never receives the password:
sending it resolves the secret host-side and pipes it straight into the
sequential Lit_ typing path. Editing an entry with a blank password keeps the
stored one; deleting an entry deletes its secret.

### Custom labels, filter and sort

Every entry can carry custom free-form labels (comma-separated in the
"Labels" field, with autocomplete from labels already used in the list —
picking a suggestion appends it after the last comma instead of replacing
what's already typed). The entry's `type` (`text`/`credentials`) also acts as
an implicit label, so it participates in filter/sort without needing to be
typed — and it's rendered as an ordinary chip alongside custom labels (no
separate badge), with **Edit**/**Delete** always pinned to the card's top
right regardless of whether the entry has a title. The **Filter** dropdown
and **Sort** dropdown both group entries under a **Type** heading (the
`text`/`credentials` values) separate from a **Labels** heading (custom
tags) — Filter checkboxes default to all checked, with "All"/"Clear"
shortcuts; entries with no custom labels of their own are always shown
regardless of the Labels checkboxes. **Sort** defaults to Title
(alphabetical); picking a Type or Label option instead brings entries
carrying that value to the top (alphabetical among themselves), followed by
the rest. Clicking outside an open dropdown closes it. Filter/sort selections
are session-only — they reset the next time the view reloads.

## Scripts view + Script Editor

Automation scripts in **RASP** format (Roku Automation Script Protocol — the
YAML format used by Roku's official [Remote Tool](https://developer.roku.com/dev/docs/roku-remote-tool)),
so scripts move freely between this extension and Roku's tool: **Export**
writes a standard `.rasp` file, **Import** loads one.

The Scripts view lists saved scripts (global storage, optional title) with
**Run / Edit / Export / Delete** per row plus an inline progress line with
**Cancel** while a run is active. `Kopytko: New Device Script` or **+ New
script** opens the editor tab.

Scripts can carry the same custom labels as Saved Text (set in the editor
tab's toolbar), and the Scripts view has the same Filter/Sort-by-label
dropdowns described under [Saved Text](#saved-text-section) — minus the
implicit type label, which only applies to Saved Text entries.

### Editor tab

A WebviewPanel with a title field, a **format switcher** (RASP today; a
`kopytko` custom automation format is planned and already modeled in the
storage schema), a monospace source editor with snippet buttons for every
command, **live validation** (parse errors with line numbers / step paths as
you type), and Save / Run / Export. Scripts are stored as raw text, so YAML
comments and anchors survive round-trips.

**Record remote** (toolbar toggle, on by default): while a script editor is
open, actions on the Remote Control view write themselves into the script —
the same authoring flow as Roku's remote tool. Button presses append
`- press: <key>` and the Send text field appends `- text: <value>`
(YAML-quoted when needed) to the end of the most recently active editor;
keyboard-remote-mode navigation keys record too. Everything still reaches the
device as usual — recording is a tap, not a mode. Free typing (`Lit_`
characters) and press-and-hold gestures are not recorded: RASP has no
keydown/keyup commands, and per-character presses would drown the script —
use the Send field for text you want scripted.

### RASP support

```yaml
params:
    rasp_version: 1
    default_keypress_wait: 2
channels:
    'My Test Channel': dev
steps:
    - press: home
    - pause: 2
    - launch:
        channel_name: My Test Channel
        content_id: 12345
        media_type: movie
        timeout: 35
    - text: developer
    - wait_for_player_state: play
    - validate_streaming:
        audio_codec: aac
        video_codec: hevc
        drm: widevine
    - loop:
        iterations: 2
        steps:
        - press: down
    - step: &nav_block
        - press: up
        - press: right
    - *nav_block
```

| Command | Runner behavior |
|---|---|
| `press: <key>` | `keypress`, then waits `default_keypress_wait` seconds (RASP default 2). Keys are RASP names (`home`, `reverse`, `replay`, …) or ECP names or `Lit_*`. |
| `text: <string>` | Sequential Lit_ typing (see Remote Control), then the default wait. |
| `pause: <seconds>` | Sleeps. |
| `launch: {channel_name/channel_id, content_id, media_type, timeout}` | `POST /launch` with deep-link params, then polls `/query/active-app` until the channel is foreground (default timeout 35 s). `channel_name` resolves through the `channels` map. |
| `wait_for_player_state: play\|pause\|stop` | Polls `GET /query/media-player` until the state matches (`stop` also matches `none`/`close`) or `runner.waitTimeoutSec` elapses → step fails. |
| `validate_streaming: {audio_codec, video_codec, drm}` | Waits (bounded) for `state=play`, then asserts each given field against the reported stream format (case-insensitive substring). |
| `loop: {iterations, steps}` | Repeats; nesting allowed. Progress counts flattened steps. |
| `- step: &id …` / `- *id` | Reusable blocks via standard YAML anchors — a definition is a no-op, each alias replays the block. |

Runs execute in the extension host (they survive collapsing the sidebar), show
per-step progress in the view/editor and in a cancellable VS Code progress
notification, and stop at the first failed step. Only one script runs at a
time — scripts drive the device's single remote-control input.

Settings: `kopytko.deviceManager.runner.pollIntervalMs` (default 500),
`kopytko.deviceManager.runner.waitTimeoutSec` (default 30).

## Device actions section

Part of the Remote Control view, below Saved Text — a `<details>` disclosure
("▾ Device actions"), **expanded by default**. It holds one flat, ordered
list of labeled rows (icon + visible label + a short description, not just
a tooltip) — earlier versions used an icon-only pill grid with tooltip-only
labels, which users didn't discover or understand at a glance:

1. **Screenshot** — captured via the web-admin; a save dialog asks where to
   write the `.jpg`, then it opens.
2. **Upload channel** — zip picker; sideloads via the web-admin Installer.
3. **Package** — zip picker → app name/version → signing password → save
   `.pkg`.
4. **Rekey** — pkg picker → signing password.
5. **Software update** — triggers a system update check (result shows on
   the device).
6. **Restart** — confirm modal, red outline.
7. **Delete channel** — confirm modal, red outline.

All 7 authenticate with the device's developer password (HTTP Digest, user
`rokudev`) from the shared device-password store; if none is saved you're
prompted once with an option to save it. See [roku-webadmin.md](./roku-webadmin.md)
for the underlying endpoint behavior.

## Secret screens section

Part of the Remote Control view, below Device actions — a `<details>`
disclosure ("▾ Secret screens"), **expanded by default**. This is a
**read-only reference list**, not a set of buttons: each row shows a
label, the exact remote-control key sequence, and what it opens. You type
these on your own physical remote — the extension deliberately does not
send them for you:

- **Enable dev mode** — `Home ×3, Up ×2, Right, Left, Right, Left, Right`.
  Opens the Developer Application Installer screen; finish the prompts
  on-device.
- **Channel info** — `Home ×3, Up ×2, Left, Right, Left, Right, Left`.
  Shows metadata, version numbers, and developer tracking IDs for
  installed channels.
- **Screenshots & Ads** — `Home ×5, Up, Right, Down, Left, Up`. Ad-banner
  behavior toggles, cycling theme logs, and screenshot capture.
- **Reset & Update** — `Home ×5, Fwd ×3, Rev ×2`. Opens a diagnostic panel
  offering Factory Reset (wipes the registry) or Soft Reset/Software
  Update.
- **Clear cache** — `Home ×5, Up, Rev ×2, Fwd ×2`. Clears temporary system
  caches and forces a hard reboot (not a registry clear); can take up to
  ~1 minute.

An earlier version of this feature tried to send these sequences
automatically via ECP (the same mechanism the on-screen remote uses for
every button press). Two of the five never triggered over ECP despite the
exact same key list working on a physical remote — see the "Secret screens:
from auto-press to reference-only" entry in
`findings/device-manager-architecture.md` for what was tried and why this
ended up as a plain reference list instead: reliability isn't guaranteed
even for the sequences that did work over ECP on the device it was tested
against, and a device-specific or firmware-specific secret sequence is
exactly the kind of thing that can silently stop working after an OS
update — not worth risking a button that might do nothing (or the wrong
thing) with no way to tell.

The Device info / Active app quick actions (which just opened raw ECP
`device-info` JSON or queried the foreground app) were removed — they
weren't needed for a remote-control-first tool. Reach for the
[`kopytko-roku` CLI](./roku-device-cli.md) or a raw ECP `device-info` request
if you need that data.

## Storage summary

| What | Where |
|---|---|
| Text/credentials entries (incl. custom labels) | `globalState` (`kopytko.deviceManager.textEntries`) |
| Credential passwords | `SecretStorage` (`kopytko.deviceManager.entry.<id>`) |
| Scripts (incl. custom labels) | `globalState` (`kopytko.deviceManager.scripts`), raw source text |
| Device developer passwords | `SecretStorage` (shared with debug/deploy) |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `kopytko.deviceManager.holdThresholdMs` | `1000` | Hold time before a button press becomes keydown/keyup |
| `kopytko.deviceManager.runner.pollIntervalMs` | `500` | Runner poll interval for launch / player-state / validation |
| `kopytko.deviceManager.runner.waitTimeoutSec` | `30` | Timeout for `wait_for_player_state` / `validate_streaming` |

## Architecture notes

- ECP key/text/media-player primitives live in the `kopytko-roku-device`
  package (`EcpClient.keypress/keydown/keyup/sendText/queryMediaPlayer/queryActiveApp`,
  `EcpKeys`, `textToLitKeys`); the RASP parser/runner and all UI live in the
  extension (`src/client/deviceManager/`) — the package stays script-format-agnostic.
- One webview bundle serves both sidebar views (Remote Control — which also
  renders Device actions and Saved Text — and Scripts), dispatched on
  `<body data-view>`; the script editor is a second bundle (it includes js-yaml
  for live validation). Sidebar views don't retain context when hidden — all
  state re-pushes on `ready`/visibility, and runs live host-side.
