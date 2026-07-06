# `kopytko-roku` CLI

A terminal client for [`kopytko-roku-device`](../packages/roku-device/README.md)'s ECP
and developer web-admin operations — everything the extension's Device Manager can do,
reachable from a shell script or CI job without VS Code.

Implemented entirely inside the standalone package
(`packages/roku-device/bin/kopytko-roku.ts`), like `kopytko-format` and `kopytko-lint`
are for their respective packages. Not surfaced anywhere in the extension itself — it's
a package-level tool, installed and run independently.

---

## Install

```bash
npm install -g kopytko-roku-device
kopytko-roku --help
```

or without installing globally:

```bash
npx kopytko-roku-device ecp device-info --host 192.168.1.20
```

---

## Usage

```
kopytko-roku discover [--timeout <ms>] [--json]
kopytko-roku ecp <op> --host <ip> [--port <n>] [--json] [op flags...]
kopytko-roku installer <op> --host <ip> --password <pw> [op flags...]
```

Global flags: `--config <path>`, `--json`, `--help`/`-h`, `--version`/`-v`.

### Config resolution

Highest priority first:

1. Command-line flags (`--host`, `--password`, `--port`)
2. `--config <path>` — a JSON file: `{ "host": "...", "password": "...", "port": 8060 }`
3. Environment variables: `ROKU_HOST`, `ROKU_PASSWORD`

This is **intentionally separate** from `kopytko-format`/`kopytko-lint`'s config
resolution, which also reads `.vscode/settings.json`. `kopytko-roku-device` stays
Kopytko-ecosystem- and editor-unaware per the package architecture rules in the root
`CLAUDE.md` — the CLI does not read `.vscode/settings.json` or `.kopytkorc`.

### Output

Ops that return a device's raw XML body (`chanperf`, `sgnodes`, `r2d2-bitmaps`,
`graphics-frame-rate`, `registry`, `tv-channels`, `tv-active-channel`) always print
that XML as-is, **`--json` included** — JSON-escaping an XML document just produces an
unreadable quoted blob with literal `\n`/`\t`, so `--json` is a no-op for these ops by
design. Everything else (objects/arrays — `device-info`, `apps`, `active-app`,
`media-player`, etc.) pretty-prints as JSON either way; `--json` mainly matters for
scripting, since text and JSON currently render the same for these. An op with no
result (e.g. `active-app` when nothing is running) prints `(none)` in text mode or
`null` in `--json` mode. Errors print `Error: <message>` to stderr and set a non-zero
exit code.

---

## `discover`

Runs an SSDP scan (UDP 1900) and prints every Roku device found.

```bash
kopytko-roku discover --timeout 3000 --json
```

## `ecp <op>`

Every op maps 1:1 to an `EcpClient` method — see
[`packages/roku-device/README.md`](../packages/roku-device/README.md#ecp-method-reference)
for the underlying endpoint each one calls.

| Op | Flags | Notes |
|---|---|---|
| `device-info` | | |
| `apps` | | |
| `active-app` | | |
| `media-player` | | |
| `icon` | `--app <id> --out <file>` | Writes the icon bytes to `--out` |
| `launch` | `--app <id> [--param k=v ...]` | Repeat `--param` for multiple deep-link params |
| `input` | `[--param k=v ...]` | Targets the foreground channel, no `--app` |
| `keypress` / `keydown` / `keyup` | `--key <KEY>` | Named key (see `EcpKeys`) or `Lit_<char>` |
| `text` | `--text "..."` | Types via sequential `Lit_` keypresses |
| `exit-app` | `--app <id> [--force]` | `--force` bypasses Instant Resume |
| `tv-channels` | | Roku TV models only |
| `tv-active-channel` | | Roku TV models only |
| `registry` | `--app <id>` | Requires developer mode |
| `chanperf` | | Requires developer mode |
| `sgnodes` | `[--scope all\|roots] [--node-id <id>]` | `--node-id` overrides `--scope` |
| `app-object-counts` | `--app <id>` | Requires developer mode |
| `app-state` | `--app <id>` | |
| `rendezvous-track` / `rendezvous-untrack` / `rendezvous-query` | | Query drains the device's event queue |
| `fwbeacons-track` / `fwbeacons-untrack` | `--app <id>` | |
| `fwbeacons-query` | | Drains the device's event queue |
| `graphics-frame-rate` | | Roku OS 12.0+, requires developer mode |
| `r2d2-bitmaps` | | Requires developer mode |
| `perfetto-enable` | `--app <id>` | Roku OS 15.2+ |
| `perfetto-trigger-heap-snapshot` | `--app <id>` | Tracing must already be enabled |

```bash
kopytko-roku ecp device-info --host 192.168.1.20
kopytko-roku ecp keypress --host 192.168.1.20 --key Home
kopytko-roku ecp launch --host 192.168.1.20 --app dev --param contentId=42 --param mediaType=movie
kopytko-roku ecp sgnodes --host 192.168.1.20 --scope roots --json
```

## `installer <op>`

Every op maps 1:1 to an `InstallerClient` method — see
[`docs/roku-webadmin.md`](./roku-webadmin.md) for the underlying web-admin behavior
(digest auth, `/plugin_install` 200-for-both-success-and-failure quirk, etc). All ops
require `--password` (username is always `rokudev`) and default to port 80.

| Op | Flags |
|---|---|
| `screenshot` | `--out <file>` |
| `install` | `--zip <path>` |
| `delete` | |
| `rekey` | `--pkg <path> --signing-password <pw>` |
| `package` | `--zip <path> --app-name-version "Name/1.0" --signing-password <pw> --out <path>` |
| `update` | |
| `reboot` | |

```bash
kopytko-roku installer screenshot --host 192.168.1.20 --password secret --out shot.jpg
kopytko-roku installer install --host 192.168.1.20 --password secret --zip ./build/archive.zip
```

---

## Exit codes

- `0` — success.
- `1` — any thrown error (missing required flag, unknown op, network failure, device
  rejection). The message is printed to stderr as `Error: <message>`.

---

## See also

- [`packages/roku-device/README.md`](../packages/roku-device/README.md) — library API,
  full ECP method table, collector inventory.
- [`docs/roku-webadmin.md`](./roku-webadmin.md) — web-admin endpoint behavior the
  `installer` ops rely on.
- [`docs/device-discovery.md`](./device-discovery.md) — the extension's own (VS
  Code-integrated) discovery/ECP/web-admin surface, distinct from this standalone CLI.
- [`findings/roku-device-api.md`](../findings/roku-device-api.md) — verified vs.
  docs-derived endpoint status.
