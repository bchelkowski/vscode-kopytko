# Kopytko Console

An interactive terminal for the Roku debug consoles, living in its own bottom-panel tab next to Terminal,
Problems, and Output. It replaces reaching for an external `telnet` client — which Windows does not ship at
all — with a real terminal that knows the commands each port accepts and colours the output by severity.

> **Status:** implemented. Works on Windows, macOS, and Linux: the transport is a plain Node TCP socket and
> the UI is a VS Code webview, so there is no platform-specific tooling anywhere in the path.

Open it from the panel area (**Kopytko Console** tab), from the Tools sidebar, or with
**Kopytko: Open Console** from the Command Palette.

The console always targets the device selected in the **Roku Devices** sidebar — there is no separate device
picker here, since two selectors could disagree. The toolbar shows the active device with a status dot
reporting the *console connection* (grey idle, yellow connecting, green connected); changing the active
device in the sidebar switches the console with it and closes the old device's connections.

---

## Ports

Only the two ports that carry an interactive command surface on current Roku OS are offered. Roku OS 7.5+
retired ports 8089–8093, and 8087 (the screensaver thread) is out of scope.

| Port | Role | What you get |
|---|---|---|
| **8085** | BrightScript runtime console | Live `print` output, framework beacons, `BRIGHTSCRIPT: ERROR`/`WARNING` diagnostics, and the interactive `BrightScript Debugger>` prompt when execution stops on a crash or break |
| **8080** | SceneGraph debug server | Utility console — `chanperf`, `sgnodes`, `sgperf`, `r2d2_bitmaps`, `free`, `fps_display`, and friends |

Both ports can be connected at the same time. The port dropdown switches which buffer is displayed; it does
not reconnect anything, and each port keeps its own scrollback, history, and log file.

### What to expect on 8085

Two behaviours, both measured against a Roku Ultra on firmware 15.2.4.3442:

- **Input is ignored while the channel is running normally.** Commands typed on 8085 get no response at
  all until execution stops and the device presents a `BrightScript Debugger>` prompt — on a crash, or a
  break. This is the device's behaviour, not a limitation of the panel. Port 8080 answers commands at any
  time.
- **Connecting replays the channel's log from launch.** Expect a burst of backlog before live output
  starts, and don't read a quiet console as a dead one.

### Sharing the device with other tools

- **Port 8085 accepts a single consumer.** If another telnet session — or a running debug session — already
  holds it, the console reports that rather than retrying silently forever. Close the other consumer and
  press Connect again.
- **Port 8080** is also used by the Runtime Diagnostics collectors. The console does not take the
  diagnostics lock, so you can run a recording and a console session together; see
  [diagnostics.md](./diagnostics.md).

---

## Command completion

Every documented command for the selected port is available as you type, with its description and argument
hint. The catalog ships with the extension, so completion never round-trips to the device.

With the input line empty, the popup lists **every** command for the port — focusing the terminal, pressing
`Tab`, or deleting back to an empty line all bring up the full list, so you never need to guess a first
letter. Typing narrows it.

| Key | Action |
|---|---|
| `Tab` | Accept the highlighted completion, or open the popup for the token under the cursor |
| `↑` / `↓` | Move through the completion list; with the popup closed, walk command history |
| `Enter` | Accept a completion that would change the line — otherwise submit the command |
| `Esc` | Dismiss the popup |
| `Ctrl+C` | Send an interrupt (breaks a running script into the debugger on 8085) |
| `Ctrl+L` | Clear the buffer |
| `Ctrl+U` / `Ctrl+K` | Kill to start / end of line |
| `Home` / `End` / `←` / `→` | Move the caret |

Two labels appear on completion entries:

- **undocumented** — the command shows up in the device's own `help` output but not in Roku's published
  documentation. It works today; it may not survive a firmware update.
- **destructive** — sending it needs an explicit confirmation. `genkey` (regenerates the developer key,
  invalidating every package signed with the old one) and `remove_plugin` (removes an app from the device
  *and all linked accounts*) are both flagged.

**Kopytko: Show Console Commands** opens the whole catalog as a searchable quick-pick.

### Port 8085 — BrightScript runtime

`bt` · `bsc` · `bscs` · `brkd` · `classes` · `cont` (`c`) · `down` (`d`) · `gc` · `help` · `last` (`l`) ·
`list` · `next` (`n`) · `over` · `out` · `print` (`p`, `?`) · `step` (`s`, `t`) · `threads` (`ths`) ·
`thread` (`th`) · `up` (`u`) · `var` · `exit`

### Port 8080 — SceneGraph debug server

`chanperf [-r <seconds>]` · `sgnodes all|roots|counts` · `sgperf start|clear|report|stop` · `r2d2_bitmaps` ·
`loaded_textures [overlay]` · `free` · `fps_display [1|0]` · `logrendezvous [on|off]` ·
`brightscript_warnings <count>` · `sgversion <force|default> <1.0|1.1>` · `remove_plugin <appId>` ·
`clear_launch_caches` · `type <text>` · `plugins` · `showkey` · `genkey` · `press` ·
`target list|<n>|<name>|-p <pid>` · `bsprof-pause|bsprof-resume|bsprof-status` · `help` (`?`) ·
`exit` (`quit`, `q`)

`sgversion` is documented by Roku but does not appear in this firmware's own `help` — it is offered, but
unconfirmed.

---

## Colouring

Output is classified per line and rendered through the **workbench's own terminal palette**
(`--vscode-terminal-ansi*`), so it follows whatever theme is active — including light and high-contrast —
rather than shipping fixed colours.

| Class | Colour | Matches |
|---|---|---|
| Error | bright red | `BRIGHTSCRIPT: ERROR`, `*** ERROR`, `Syntax Error`, `Type Mismatch`, `Runtime Error`, `Backtrace:`, and bracketed level tags like `[Failed.…]` / `[Error.…]` |
| Warning | bright yellow | `BRIGHTSCRIPT: WARNING`, `WARNING:`, `Unable to`, `deprecated`, `[Warning.…]` |
| Beacon | bright cyan | `[beacon.signal]`, `AppLaunchInitiate`/`AppLaunchComplete`/`VODStart*`, `app-launch-complete` |
| Debugger | bright green | `BrightScript Debugger>`, `Current Function:`, `#0 …` backtrace frames |
| XML | dimmed | 8080's XML replies — tags dimmed so the values stand out |

The bracketed forms (`[Warning.MultiProfile] |…`) are an app-logger convention rather than a Roku one, but
common enough in real channels to be worth matching.

> **There is no rendezvous class.** `logrendezvous on` was measured against a real device and emits nothing
> on either port — rendezvous data reaches the extension over ECP `/query/sgrendezvous` and belongs to the
> [Diagnostics panel](./diagnostics.md).

Within a line, timestamps are dimmed, thread tags (`app`, `sdkl`) are blue, values with units
(`53920KiB`, `18ms`, `0%`) are yellow, and `pkg:/…(line)` references are underlined cyan.

Set `kopytko.console.colorize` to `false` to render everything in the default foreground colour.

**Device output is sanitised before display.** Escape sequences emitted by the running channel are stripped,
so a stray `print` cannot repaint the terminal, move the cursor, or corrupt the input line.

---

## Click-to-open source

Any `pkg:/components/Foo.brs(40)` reference in the output is a link. Clicking it resolves the path against
the workspace — including Kopytko packages under `node_modules` — and opens the file at that line. This
reuses the same resolver the diagnostics rendezvous table uses.

Bare references without the `pkg:/` prefix (`Foo.brs(12)`, as 8085 sometimes prints) are matched too.

---

## Filtering

The filter box narrows the visible buffer without touching what is captured:

- Plain text matches case-insensitively as a substring.
- `/pattern/flags` is treated as a regular expression — `/ERROR|WARNING/`. An expression that is still
  half-typed falls back to substring matching instead of clearing the view.

The severity chips beside it (`error`, `warning`, `beacon`, `debugger`) narrow by class. With none selected
everything is shown; selecting several shows the union. Filters compose: a text filter and chips both apply.

The footer shows `N of M lines` whenever a filter is hiding something.

---

## Saving output

**Save** writes the current buffer to `<workspace>/<kopytko.console.outputDir>/console-<port>-<timestamp>.log`
as plain, uncoloured text, and offers to open it.

Setting `kopytko.console.logToFile` to `true` additionally appends every line to a log file *as it arrives*,
so a crash that takes the panel with it still leaves a complete record on disk. The footer shows the active
log file path.

---

## Commands

| Command | Title |
|---|---|
| `kopytko.console.open` | Kopytko: Open Console |
| `kopytko.console.connect` | Kopytko: Connect Console |
| `kopytko.console.disconnect` | Kopytko: Disconnect Console |
| `kopytko.console.clear` | Kopytko: Clear Console |
| `kopytko.console.saveOutput` | Kopytko: Save Console Output |
| `kopytko.console.selectPort` | Kopytko: Select Console Port |
| `kopytko.console.showCommands` | Kopytko: Show Console Commands |

## Settings

| Setting | Default | Description |
|---|---|---|
| `kopytko.console.defaultPort` | `8085` | Port selected when the panel opens (`8085` or `8080`). |
| `kopytko.console.autoConnect` | `false` | Connect to the active device automatically when the panel opens. |
| `kopytko.console.maxLines` | `20000` | Maximum output lines kept per port; older lines are dropped. |
| `kopytko.console.reconnect` | `true` | Reconnect automatically, with backoff, when the connection drops. |
| `kopytko.console.colorize` | `true` | Colour output by severity. |
| `kopytko.console.logToFile` | `false` | Append every line to a log file as it arrives. |
| `kopytko.console.outputDir` | `"debug"` | Folder (workspace-relative or absolute) for console logs and saved output. |
| `kopytko.console.historySize` | `200` | Commands remembered per port for history recall. |

---

## Architecture

Follows the package boundary described in the root `CLAUDE.md`: anything that talks to the device lives in
`kopytko-roku-device`, and `src/client/console/` is VS Code glue only.

| Piece | Where | Responsibility |
|---|---|---|
| `ConsoleStream` | `packages/roku-device/src/console/consoleStream.ts` | Raw bidirectional TCP. Forwards every byte verbatim, reconnects with exponential backoff, drops writes while disconnected. |
| Command catalog | `packages/roku-device/src/console/commandCatalog.ts` | Per-port command specs, `completeCommand()`, `isDestructiveCommand()`. |
| `ConsoleController` | `src/client/console/consoleController.ts` | One stream per (device, port); chunk→line assembly, capped buffers, history, file logging. |
| `classifyLine` | `src/client/console/lineClassifier.ts` | Pure text → severity + token spans + source reference. No `vscode` or DOM imports, so it is shared by the webview bundle and the unit tests. |
| `ConsoleViewProvider` | `src/client/console/views/consoleViewProvider.ts` | Webview host: batches lines every 100 ms, serializes the catalog, owns the destructive-command modal. |
| Webview | `src/client/console/webview/` | xterm.js terminal, line editor, completion popup, filter. |

### Why not reuse `DebugConsoleClient`

The existing port-8080 client (used by the diagnostics collectors) is request/response: it frames a reply by
idle time, strips the banner and `>` prompts, and **discards unsolicited data between commands**. All three
behaviours are wrong for a terminal, where the prompt is meaningful and async output is the point. The two
clients coexist; neither is layered on the other.

### Notes for maintainers

- **Line assembly happens host-side.** A TCP chunk can split mid-line, so the controller holds the trailing
  partial until the rest arrives and only ever emits whole lines.
- **The webview owns the authoritative buffer.** xterm's scrollback is a *rendering* of that array, which is
  what makes filtering possible — changing a filter clears the terminal and replays the matching lines.
- **Neither console echoes input**, so the webview local-echoes the input row itself, erasing and repainting
  it around every write so output always lands above the prompt.
- **The terminal is fitted only when the container has a real size.** A VS Code panel measures a handful of
  pixels mid-layout and while collapsed; fitting then locks xterm into a 2×1 grid it never grows out of.
