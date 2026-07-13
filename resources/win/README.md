# Bundled WinDivert (x64)

`x64/WinDivert.dll` and `x64/WinDivert64.sys` are the official, unmodified
WinDivert 2.2.2 (x64) redistributable binaries, used by the Network
Inspector's Windows transparent-redirect companion
(`src/client/network/redirect/windows/`) — see
[`docs/network-inspector.md`](../../docs/network-inspector.md#windows-transparent-redirect-windivert).

- **Project**: [WinDivert](https://reqrypt.org/windivert.html) by basil
  (source: https://github.com/basil00/Divert)
- **Version bundled**: 2.2.2
- **License**: dual LGPLv3 / GPLv2 — see [`WINDIVERT-LICENSE.txt`](./WINDIVERT-LICENSE.txt)
  (the same LICENSE file shipped in the official WinDivert distribution).
  WinDivert is explicitly designed to be redistributed alongside applications
  that use it, which is what this bundling does — this extension neither
  modifies nor relicenses it.
- **Not signed/built by this project** — these are the exact binaries from
  the official WinDivert release archive, copied in unmodified.

Only the x64 driver is bundled (this covers the overwhelming majority of
Windows installs). On non-x64 Windows (e.g. ARM64), the Network Inspector's
Windows redirect reports itself unsupported unless
`kopytko.network.winDivertDir` is pointed at a compatible WinDivert build.
