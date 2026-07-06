# Device Manager

A dedicated Activity Bar container (`Kopytko Device Manager`) bundling everything
needed to drive a Roku device by hand or by script: an on-screen **Remote
Control**, reusable **Saved Text** entries (including credentials), a **RASP
script** library with an editor tab and runner, and a **Device** abilities view
surfacing ECP quick actions and the full developer web-admin automation.

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
- **Typing printable characters works while the Remote Control view is
  focused** — the webview converts them to `Lit_` keypresses. Only printable
  characters are captured in the webview: VS Code re-dispatches webview
  keyboard events to the workbench, so the navigation keybindings above fire
  even with the view focused, and handling them in the webview too would
  double-send every key.

Design note: the `type`-command override (used by some extensions to capture
editor typing) was rejected on purpose — only one extension per window can
register it (VSCodeVim and rokucommunity's BrightScript extension already do,
and both are likely co-installed), and it only fires while a text editor has
focus anyway.

## Saved Text view

Reusable entries for text you type on devices often — search terms, deep-link
IDs, and test-account credentials:

- **Text** entries hold one string and one **Send** button.
- **Credentials** entries hold an email/login and a password — two independent
  **Send** buttons, so a login screen is two clicks (plus navigating between
  the fields on-device).
- Every entry has an optional title for the list.

Entries are stored **globally** (they follow you across workspaces).
**Passwords never touch the Memento** — they live in VS Code SecretStorage
(the OS keychain), keyed per entry (`kopytko.deviceManager.entry.<id>`), the
same mechanism as device passwords. The webview never receives the password:
sending it resolves the secret host-side and pipes it straight into the
sequential Lit_ typing path. Editing an entry with a blank password keeps the
stored one; deleting an entry deletes its secret.

## Scripts view + Script Editor

Automation scripts in **RASP** format (Roku Automation Script Protocol — the
YAML format used by Roku's official [Remote Tool](https://developer.roku.com/dev/docs/roku-remote-tool)),
so scripts move freely between this extension and Roku's tool: **Export**
writes a standard `.rasp` file, **Import** loads one.

The Scripts view lists saved scripts (global storage, optional title) with
**Run / Edit / Export / Delete** per row plus an inline progress line with
**Cancel** while a run is active. `Kopytko: New Device Script` or **+ New
script** opens the editor tab.

### Editor tab

A WebviewPanel with a title field, a **format switcher** (RASP today; a
`kopytko` custom automation format is planned and already modeled in the
storage schema), a monospace source editor with snippet buttons for every
command, **live validation** (parse errors with line numbers / step paths as
you type), and Save / Run / Export. Scripts are stored as raw text, so YAML
comments and anchors survive round-trips.

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

## Device view (abilities hub)

Two button groups; anything that needs input uses native VS Code dialogs
instead of sidebar forms:

- **Quick actions** — Device info (full ECP `device-info` opened as JSON),
  Active app, Screenshot (captured via the web-admin, saved to extension
  storage and opened), Check update, Reboot (confirm modal).
- **Web admin** — Install channel (zip picker), Delete channel (confirm),
  Package (zip picker → app name/version → signing password → save `.pkg`),
  Rekey (pkg picker → signing password). See [roku-webadmin.md](./roku-webadmin.md)
  for the underlying endpoint behavior.

Web-admin actions authenticate with the device's developer password (HTTP
Digest, user `rokudev`) from the shared device-password store; if none is
saved you're prompted once with an option to save it.

## Storage summary

| What | Where |
|---|---|
| Text/credentials entries | `globalState` (`kopytko.deviceManager.textEntries`) |
| Credential passwords | `SecretStorage` (`kopytko.deviceManager.entry.<id>`) |
| Scripts | `globalState` (`kopytko.deviceManager.scripts`), raw source text |
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
- One webview bundle serves all four sidebar views, dispatched on
  `<body data-view>`; the script editor is a second bundle (it includes js-yaml
  for live validation). Sidebar views don't retain context when hidden — all
  state re-pushes on `ready`/visibility, and runs live host-side.
