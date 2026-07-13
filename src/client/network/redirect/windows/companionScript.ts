/**
 * Builds the PowerShell + embedded-C# "companion" script that implements a
 * real packet-level transparent redirect on Windows via WinDivert
 * (https://github.com/basil00/Divert) — the Windows equivalent of the
 * `iptables`/`pf` redirects `redirectController.ts` already does on
 * Linux/macOS. `netsh interface portproxy` (Windows' only built-in
 * alternative) can only forward traffic already addressed *to* this machine
 * and only per-port, which is why an app's hardcoded `https://` bootstrap
 * call could never be captured that way — DNS-based redirection has no
 * concept of port/protocol. WinDivert intercepts traffic at the packet level
 * while it merely transits this machine as the device's ICS gateway, so it
 * works for any port/protocol simultaneously.
 *
 * Pure string generation, no vscode/OS dependency — unit-tested directly.
 * The generated script is written to disk and launched elevated by
 * `companionSupervisor.ts`; it is never executed from this module.
 *
 * Architecture validated live against a real device before this was written
 * (see findings/network-inspector.md): two WinDivert handles are required —
 * one `NETWORK_FORWARD` handle captures the device's outbound traffic, and a
 * second `NETWORK` handle is required to actually deliver a rewritten packet
 * toward the local capture proxy (a single FORWARD handle can't do that). A
 * third, `SEND_ONLY` handle with a filter that matches nothing (`"false"`)
 * is used purely for injecting the request leg — WinDivertSend does not
 * require the outgoing packet to match the sending handle's own filter, and
 * a broadly-matching injection handle was found to silently steal packets
 * the reply-capturing handle needed.
 */

export interface CompanionScriptOptions {
  /** Absolute path to WinDivert.dll (WinDivert64.sys must sit alongside it). */
  winDivertDllPath: string;
  rokuIp: string;
  proxyPort: number;
  /** Device-side ports to redirect. */
  ports: number[];
  /** This machine's IP on the device's subnet (the ICS-shared adapter). */
  gatewayIp: string;
  /** Named pipe name (without the `\\.\pipe\` prefix). */
  pipeName: string;
  /** Random per-session token the extension host must send first on the pipe. */
  token: string;
  /** Where the companion appends structured log lines. */
  logPath: string;
  /** Where the companion writes its `{state, detail}` readiness status. */
  statusPath: string;
}

export function buildWindowsCompanionScript(o: CompanionScriptOptions): string {
  const portsLiteral = `@(${o.ports.join(',')})`;

  return `# Kopytko Network Inspector — Windows WinDivert companion
# Generated. Do not edit by hand — regenerated fresh on every capture start.
#
# Runs elevated for as long as traffic capture is enabled. Redirects the
# device's outbound traffic at the packet level into the local capture proxy
# and back, using WinDivert (https://reqrypt.org/windivert.html, LGPLv3/GPLv2).
# The redirect only exists while this process's WinDivert handles stay open —
# closing them (including via ordinary process exit, a crash, or Task Manager
# "End Task") immediately and fully restores normal Windows networking. This
# process also self-terminates if it stops hearing from the extension host
# for ${HEARTBEAT_TIMEOUT_SEC} seconds, so a crashed VS Code can never leave the redirect running unattended.

$ErrorActionPreference = 'Stop'

$winDivertDllPath = '${psSingleQuote(o.winDivertDllPath)}'
$rokuIp = '${psSingleQuote(o.rokuIp)}'
$proxyPort = ${o.proxyPort}
$ports = ${portsLiteral}
$gatewayIp = '${psSingleQuote(o.gatewayIp)}'
$pipeName = '${psSingleQuote(o.pipeName)}'
$token = '${psSingleQuote(o.token)}'
$logPath = '${psSingleQuote(o.logPath)}'
$statusPath = '${psSingleQuote(o.statusPath)}'

# Resolved fresh on every run rather than hardcoded: the same physical
# ICS-gateway path reports a DIFFERENT interface index depending on traffic
# direction. The Roku's own outbound-for-forwarding traffic (NETWORK_FORWARD
# layer) is keyed off the real internet-facing adapter, but packets we
# reinject back toward the Roku need the ICS-shared virtual adapter's own
# index — using the wrong one for either leg makes WinDivertSend report
# success while silently dropping every packet, with no error at the API
# level. (Confirmed empirically; not documented behavior.)
$loopbackIfIdx = (Get-NetIPAddress -IPAddress '127.0.0.1' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex
$icsIfIdx = (Get-NetIPAddress -IPAddress $gatewayIp -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex

function Write-CompanionStatus($state, $detail) {
  $json = '{"state":"' + $state + '","detail":"' + ($detail -replace '\\\\', '\\\\\\\\' -replace '"', '\\\\"') + '"}'
  Set-Content -Path $statusPath -Value $json -Encoding utf8
}

if (-not $loopbackIfIdx -or -not $icsIfIdx) {
  Write-CompanionStatus 'failed' "could not resolve interface index (loopback=$loopbackIfIdx ics=$icsIfIdx for gateway $gatewayIp)"
  exit 1
}

try {

Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

public static class WinDivertApi {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr LoadLibrary(string dllPath);

    [DllImport("WinDivert.dll", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern IntPtr WinDivertOpen(string filter, int layer, short priority, ulong flags);

    [DllImport("WinDivert.dll", SetLastError = true)]
    public static extern bool WinDivertRecv(IntPtr handle, byte[] pPacket, uint packetLen, out uint pRecvLen, byte[] pAddr);

    [DllImport("WinDivert.dll", SetLastError = true)]
    public static extern bool WinDivertSend(IntPtr handle, byte[] pPacket, uint packetLen, out uint pSendLen, byte[] pAddr);

    [DllImport("WinDivert.dll", SetLastError = true)]
    public static extern bool WinDivertClose(IntPtr handle);

    [DllImport("WinDivert.dll", SetLastError = true)]
    public static extern bool WinDivertHelperCalcChecksums(byte[] pPacket, uint packetLen, byte[] pAddr, ulong flags);
}

// Setting a SACL (required for the pipe's mandatory-integrity-label fix below)
// needs SeSecurityPrivilege held *and enabled* in the calling token. Even a
// full Administrator elevation has this privilege present but disabled by
// default — omitting this step fails with Win32 error 1314
// (ERROR_PRIVILEGE_NOT_HELD, ".NET: "a required privilege is not held by the
// client") despite already running elevated. Confirmed live: WinDivert opened
// fine and the redirect was active, only the pipe's SACL assignment failed.
public static class TokenPrivileges {
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out LUID lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, uint BufferLength, IntPtr PreviousState, IntPtr ReturnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    struct LUID { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    struct LUID_AND_ATTRIBUTES { public LUID Luid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_PRIVILEGES { public uint PrivilegeCount; public LUID_AND_ATTRIBUTES Privileges; }

    const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    const uint TOKEN_QUERY = 0x0008;
    const uint SE_PRIVILEGE_ENABLED = 0x0002;

    public static void EnableSeSecurityPrivilege() {
        IntPtr tokenHandle;
        if (!OpenProcessToken(Process.GetCurrentProcess().Handle, TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out tokenHandle))
            throw new Exception("OpenProcessToken failed - Win32 error " + Marshal.GetLastWin32Error());
        try {
            LUID luid;
            if (!LookupPrivilegeValue(null, "SeSecurityPrivilege", out luid))
                throw new Exception("LookupPrivilegeValue(SeSecurityPrivilege) failed - Win32 error " + Marshal.GetLastWin32Error());

            TOKEN_PRIVILEGES tp;
            tp.PrivilegeCount = 1;
            tp.Privileges = new LUID_AND_ATTRIBUTES { Luid = luid, Attributes = SE_PRIVILEGE_ENABLED };
            if (!AdjustTokenPrivileges(tokenHandle, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero))
                throw new Exception("AdjustTokenPrivileges(SeSecurityPrivilege) failed - Win32 error " + Marshal.GetLastWin32Error());
            int lastError = Marshal.GetLastWin32Error();
            if (lastError != 0) // AdjustTokenPrivileges can return true yet still not grant everything requested.
                throw new Exception("AdjustTokenPrivileges(SeSecurityPrivilege) did not fully apply - Win32 error " + lastError);
        } finally {
            CloseHandle(tokenHandle);
        }
    }
}

public class NatEntry {
    public byte[] OrigDstIp;
    public int OrigDstPort;
    public DateTime LastSeen;
}

public static class Companion {
    const int LAYER_NETWORK = 0;
    const int LAYER_NETWORK_FORWARD = 1;
    const ulong FLAG_SEND_ONLY = 0x0008;
    const int NAT_IDLE_TIMEOUT_SEC = 120;
    public const int HEARTBEAT_TIMEOUT_SEC = ${HEARTBEAT_TIMEOUT_SEC};

    static IntPtr HandleA = IntPtr.Zero;      // NETWORK_FORWARD: captures the device's outbound traffic.
    static IntPtr HandleB = IntPtr.Zero;      // NETWORK: captures the proxy's loopback replies.
    static IntPtr HandleInject = IntPtr.Zero; // NETWORK, filter "false", SEND_ONLY: injects the request leg toward loopback.

    static ConcurrentDictionary<int, NatEntry> NatTable = new ConcurrentDictionary<int, NatEntry>();
    static volatile bool Running = false;
    static byte[] RokuIpBytes;
    static int ProxyPort;
    static int LoopbackIfIdx;
    static int IcsIfIdx;
    static long PacketsAtoB = 0;
    static long PacketsBtoA = 0;
    static DateTime StartedAt;
    static DateTime LastHeartbeat;
    static string LogPath;
    static string StatusPath;
    static readonly object LogLock = new object();

    static void Log(string msg) {
        lock (LogLock) {
            try { File.AppendAllText(LogPath, DateTime.UtcNow.ToString("o") + " " + msg + Environment.NewLine); }
            catch { /* best-effort logging only */ }
        }
    }

    static void WriteStatus(string state, string detail) {
        try {
            string json = "{\\"state\\":\\"" + state + "\\",\\"detail\\":\\"" + JsonEscape(detail) + "\\",\\"pid\\":" + Process.GetCurrentProcess().Id + "}";
            File.WriteAllText(StatusPath, json);
        } catch { /* best-effort status only */ }
    }

    static string JsonEscape(string s) {
        if (s == null) return "";
        return s.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"").Replace("\\r", "").Replace("\\n", " ");
    }

    // Deliberately not named "Main" — a method with that exact name is always
    // scanned by the C# compiler as a candidate assembly entry point, and one
    // whose signature doesn't match a valid Main() gets CS0028 ("cannot be an
    // entry point because it has an incorrect signature"), which Add-Type's
    // compiler treats as an error, not just a warning. This is a plain method
    // invoked manually from PowerShell below, never an actual entry point.
    public static void Run(string dllPath, string rokuIp, int proxyPort, int[] ports, int loopbackIfIdx, int icsIfIdx, string pipeName, string token, string logPath, string statusPath) {
        LogPath = logPath;
        StatusPath = statusPath;
        ProxyPort = proxyPort;
        LoopbackIfIdx = loopbackIfIdx;
        IcsIfIdx = icsIfIdx;
        RokuIpBytes = IPAddress.Parse(rokuIp).GetAddressBytes();
        LastHeartbeat = DateTime.UtcNow;

        WriteStatus("starting", "");
        Log("Companion starting. rokuIp=" + rokuIp + " proxyPort=" + proxyPort + " ports=" + string.Join(",", ports) + " loopbackIfIdx=" + loopbackIfIdx + " icsIfIdx=" + icsIfIdx);

        IntPtr loaded = WinDivertApi.LoadLibrary(dllPath);
        if (loaded == IntPtr.Zero) {
            string msg = "LoadLibrary failed for " + dllPath + " - Win32 error " + Marshal.GetLastWin32Error();
            Log("FATAL: " + msg);
            WriteStatus("failed", msg);
            return;
        }

        string portFilter = "(" + string.Join(" or ", Array.ConvertAll(ports, p => "tcp.DstPort == " + p)) + ")";
        string filterA = "ip.SrcAddr == " + rokuIp + " and " + portFilter;
        HandleA = WinDivertApi.WinDivertOpen(filterA, LAYER_NETWORK_FORWARD, 0, 0);
        if (HandleA == new IntPtr(-1)) {
            string msg = "WinDivertOpen(HandleA) failed - Win32 error " + Marshal.GetLastWin32Error();
            Log("FATAL: " + msg);
            WriteStatus("failed", msg);
            return;
        }

        string filterB = "outbound and ip.SrcAddr == 127.0.0.1 and tcp.SrcPort == " + proxyPort;
        HandleB = WinDivertApi.WinDivertOpen(filterB, LAYER_NETWORK, 0, 0);
        if (HandleB == new IntPtr(-1)) {
            string msg = "WinDivertOpen(HandleB) failed - Win32 error " + Marshal.GetLastWin32Error();
            Log("FATAL: " + msg);
            WriteStatus("failed", msg);
            WinDivertApi.WinDivertClose(HandleA);
            return;
        }

        // Filter "false" matches nothing, ever — WinDivertSend does not require the
        // outgoing packet to match the sending handle's own filter, so this handle
        // exists purely to inject. A broader filter here (even with SEND_ONLY) was
        // found to silently capture and blackhole traffic HandleB needed.
        HandleInject = WinDivertApi.WinDivertOpen("false", LAYER_NETWORK, 0, FLAG_SEND_ONLY);
        if (HandleInject == new IntPtr(-1)) {
            string msg = "WinDivertOpen(HandleInject) failed - Win32 error " + Marshal.GetLastWin32Error();
            Log("FATAL: " + msg);
            WriteStatus("failed", msg);
            WinDivertApi.WinDivertClose(HandleA);
            WinDivertApi.WinDivertClose(HandleB);
            return;
        }

        Running = true;
        StartedAt = DateTime.UtcNow;
        Log("WinDivert handles open. Redirect active.");
        WriteStatus("ready", "redirect active");

        new Thread(RecvLoopA) { IsBackground = true }.Start();
        new Thread(RecvLoopB) { IsBackground = true }.Start();
        new Thread(NatSweepLoop) { IsBackground = true }.Start();
        new Thread(WatchdogLoop) { IsBackground = true }.Start();

        RunPipeServer(pipeName, token); // blocks until a "stop" command or heartbeat timeout

        Shutdown();
    }

    static void RecvLoopA() {
        byte[] packetBuf = new byte[65535];
        byte[] addrBuf = new byte[80];
        while (Running) {
            uint recvLen;
            bool ok = WinDivertApi.WinDivertRecv(HandleA, packetBuf, (uint)packetBuf.Length, out recvLen, addrBuf);
            if (!ok) {
                if (!Running) break;
                Log("RecvLoopA: WinDivertRecv failed - Win32 error " + Marshal.GetLastWin32Error());
                continue;
            }
            try {
                int ihl = (packetBuf[0] & 0x0F) * 4;
                int srcPort = (packetBuf[ihl] << 8) | packetBuf[ihl + 1];
                byte[] origDst = new byte[4];
                Array.Copy(packetBuf, 16, origDst, 0, 4);
                int origDstPort = (packetBuf[ihl + 2] << 8) | packetBuf[ihl + 3];

                NatTable[srcPort] = new NatEntry { OrigDstIp = origDst, OrigDstPort = origDstPort, LastSeen = DateTime.UtcNow };

                byte[] loop = new byte[] { 127, 0, 0, 1 };
                Array.Copy(loop, 0, packetBuf, 12, 4);
                Array.Copy(loop, 0, packetBuf, 16, 4);
                packetBuf[ihl + 2] = (byte)(ProxyPort >> 8);
                packetBuf[ihl + 3] = (byte)(ProxyPort & 0xFF);

                byte[] injectAddr = (byte[])addrBuf.Clone();
                SetAddrFields(injectAddr, LAYER_NETWORK, true, true, LoopbackIfIdx, 0);

                WinDivertApi.WinDivertHelperCalcChecksums(packetBuf, recvLen, injectAddr, 0);
                uint sendLen;
                bool sent = WinDivertApi.WinDivertSend(HandleInject, packetBuf, recvLen, out sendLen, injectAddr);
                if (!sent) Log("RecvLoopA: WinDivertSend failed - Win32 error " + Marshal.GetLastWin32Error());
                else Interlocked.Increment(ref PacketsAtoB);
            } catch (Exception ex) {
                Log("RecvLoopA: exception " + ex.Message);
            }
        }
    }

    static void RecvLoopB() {
        byte[] packetBuf = new byte[65535];
        byte[] addrBuf = new byte[80];
        while (Running) {
            uint recvLen;
            bool ok = WinDivertApi.WinDivertRecv(HandleB, packetBuf, (uint)packetBuf.Length, out recvLen, addrBuf);
            if (!ok) {
                if (!Running) break;
                Log("RecvLoopB: WinDivertRecv failed - Win32 error " + Marshal.GetLastWin32Error());
                continue;
            }
            try {
                int ihl = (packetBuf[0] & 0x0F) * 4;
                int dstPort = (packetBuf[ihl + 2] << 8) | packetBuf[ihl + 3];

                NatEntry entry;
                if (!NatTable.TryGetValue(dstPort, out entry)) continue; // stale/unknown reply — drop rather than guess.
                entry.LastSeen = DateTime.UtcNow;

                Array.Copy(entry.OrigDstIp, 0, packetBuf, 12, 4);
                Array.Copy(RokuIpBytes, 0, packetBuf, 16, 4);
                packetBuf[ihl] = (byte)(entry.OrigDstPort >> 8);
                packetBuf[ihl + 1] = (byte)(entry.OrigDstPort & 0xFF);

                byte[] injectAddr = (byte[])addrBuf.Clone();
                SetAddrFields(injectAddr, LAYER_NETWORK_FORWARD, true, false, IcsIfIdx, 0);

                WinDivertApi.WinDivertHelperCalcChecksums(packetBuf, recvLen, injectAddr, 0);
                uint sendLen;
                bool sent = WinDivertApi.WinDivertSend(HandleA, packetBuf, recvLen, out sendLen, injectAddr);
                if (!sent) Log("RecvLoopB: WinDivertSend failed - Win32 error " + Marshal.GetLastWin32Error());
                else Interlocked.Increment(ref PacketsBtoA);
            } catch (Exception ex) {
                Log("RecvLoopB: exception " + ex.Message);
            }
        }
    }

    static void SetAddrFields(byte[] addr, int layer, bool outbound, bool loopback, int ifIdx, int subIfIdx) {
        uint packed = BitConverter.ToUInt32(addr, 8);
        packed = (packed & 0xFFFFFF00u) | (uint)(layer & 0xFF);
        packed = SetBit(packed, 17, outbound);
        packed = SetBit(packed, 18, loopback);
        Array.Copy(BitConverter.GetBytes(packed), 0, addr, 8, 4);
        Array.Copy(BitConverter.GetBytes(ifIdx), 0, addr, 16, 4);
        Array.Copy(BitConverter.GetBytes(subIfIdx), 0, addr, 20, 4);
    }

    static uint SetBit(uint value, int bit, bool set) {
        return set ? (value | (1u << bit)) : (value & ~(1u << bit));
    }

    static void NatSweepLoop() {
        while (Running) {
            Thread.Sleep(10000);
            DateTime cutoff = DateTime.UtcNow.AddSeconds(-NAT_IDLE_TIMEOUT_SEC);
            foreach (var kv in NatTable) {
                if (kv.Value.LastSeen < cutoff) {
                    NatEntry removed;
                    NatTable.TryRemove(kv.Key, out removed);
                }
            }
        }
    }

    // Self-termination if the extension host goes silent — covers the case where
    // VS Code itself crashes or is killed without this process's own handles ever
    // being torn down by the OS (e.g. it stays alive as an orphaned elevated
    // process). Ordinary process death already closes the WinDivert handles for
    // free; this is the belt-and-braces case where THIS process is still alive
    // but nothing is driving it anymore.
    static void WatchdogLoop() {
        while (Running) {
            Thread.Sleep(1000);
            if ((DateTime.UtcNow - LastHeartbeat).TotalSeconds > HEARTBEAT_TIMEOUT_SEC) {
                Log("Heartbeat timeout - extension host appears to be gone. Shutting down redirect for safety.");
                Running = false;
                break;
            }
        }
    }

    static void Shutdown() {
        Running = false;
        if (HandleA != IntPtr.Zero) WinDivertApi.WinDivertClose(HandleA);
        if (HandleB != IntPtr.Zero) WinDivertApi.WinDivertClose(HandleB);
        if (HandleInject != IntPtr.Zero) WinDivertApi.WinDivertClose(HandleInject);
        Log("Companion shut down. All WinDivert handles closed, normal Windows networking resumed.");
        WriteStatus("stopped", "shutdown complete");
    }

    static void RunPipeServer(string pipeName, string token) {
        // Must happen before assigning the SACL below, or PipeSecurity throws
        // "a required privilege is not held by the client" (ERROR_PRIVILEGE_NOT_HELD)
        // even though this process is fully elevated.
        TokenPrivileges.EnableSeSecurityPrivilege();

        var sid = WindowsIdentity.GetCurrent().User;
        var pipeSecurity = new PipeSecurity();
        pipeSecurity.SetAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
        // This process is elevated, so the pipe it creates defaults to a High
        // mandatory integrity label — the non-elevated extension host (Medium IL,
        // same user) would then be silently denied a connection by Windows'
        // mandatory integrity control, not by the DACL above. Explicitly lowering
        // the object's mandatory label removes that "no write up" barrier. This is
        // the standard, documented workaround for IPC across a UAC elevation
        // boundary between two processes of the same user.
        string sddl = pipeSecurity.GetSecurityDescriptorSddlForm(AccessControlSections.Access) + "S:(ML;;;;;LW)";
        pipeSecurity.SetSecurityDescriptorSddlForm(sddl);

        while (Running) {
            using (var server = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, pipeSecurity)) {
                try {
                    var waitResult = server.BeginWaitForConnection(null, null);
                    while (Running && !waitResult.IsCompleted) waitResult.AsyncWaitHandle.WaitOne(500);
                    if (!Running) break;
                    server.EndWaitForConnection(waitResult);
                } catch (Exception ex) {
                    Log("Pipe wait failed: " + ex.Message);
                    continue;
                }

                LastHeartbeat = DateTime.UtcNow;
                try { HandleClient(server, token); }
                catch (Exception ex) { Log("Pipe client handling error: " + ex.Message); }
            }
            // A dropped connection without a clean "stop" is covered by the
            // watchdog's heartbeat timeout above, not treated as fatal here — lets
            // the extension reconnect after e.g. a webview reload.
        }
    }

    static void HandleClient(NamedPipeServerStream server, string token) {
        using (var reader = new StreamReader(server, Encoding.UTF8, false, 4096, true))
        using (var writer = new StreamWriter(server, new UTF8Encoding(false), 4096, true) { AutoFlush = true }) {
            string authLine = reader.ReadLine();
            if (authLine != token) {
                Log("Pipe client rejected: bad token.");
                writer.WriteLine("{\\"ok\\":false,\\"error\\":\\"bad token\\"}");
                return;
            }
            writer.WriteLine("{\\"ok\\":true,\\"event\\":\\"connected\\"}");

            string line;
            while (Running && (line = reader.ReadLine()) != null) {
                LastHeartbeat = DateTime.UtcNow;
                string trimmed = line.Trim();
                if (trimmed == "ping") {
                    writer.WriteLine("{\\"ok\\":true,\\"event\\":\\"pong\\"}");
                } else if (trimmed == "status") {
                    writer.WriteLine("{\\"ok\\":true,\\"event\\":\\"status\\",\\"natEntries\\":" + NatTable.Count +
                        ",\\"packetsAtoB\\":" + Interlocked.Read(ref PacketsAtoB) +
                        ",\\"packetsBtoA\\":" + Interlocked.Read(ref PacketsBtoA) +
                        ",\\"uptimeSec\\":" + (long)(DateTime.UtcNow - StartedAt).TotalSeconds + "}");
                } else if (trimmed == "stop") {
                    writer.WriteLine("{\\"ok\\":true,\\"event\\":\\"stopping\\"}");
                    Log("Stop command received. Shutting down.");
                    Running = false;
                    return;
                } else {
                    writer.WriteLine("{\\"ok\\":false,\\"error\\":\\"unknown command\\"}");
                }
            }
        }
    }
}
"@

Write-CompanionStatus 'starting' ''
[Companion]::Run($winDivertDllPath, $rokuIp, $proxyPort, $ports, $loopbackIfIdx, $icsIfIdx, $pipeName, $token, $logPath, $statusPath)

} catch {
  # Covers failures with nothing above to catch them — most notably an
  # Add-Type compile error, which is a PowerShell-level terminating error
  # thrown before Companion.Run ever runs, so none of the C# side's own
  # logging/status-writing code has executed yet. Without this, that class
  # of failure is completely silent: no log file, no status file, just an
  # elevated window that flashes and closes — indistinguishable from the
  # companion simply never having launched at all.
  $errText = $_.Exception.Message
  try {
    Add-Content -Path $logPath -Value ([DateTime]::UtcNow.ToString('o') + ' FATAL (PowerShell-level, before/outside Companion.Run): ' + $errText) -Encoding utf8
  } catch { }
  Write-CompanionStatus 'failed' $errText
  exit 1
}
`;
}

/** Seconds of pipe silence from the extension host before the companion self-terminates. */
export const HEARTBEAT_TIMEOUT_SEC = 15;

/** Escapes a literal for a PowerShell single-quoted string (double any `'`). */
function psSingleQuote(s: string): string {
  return s.replace(/'/g, "''");
}
