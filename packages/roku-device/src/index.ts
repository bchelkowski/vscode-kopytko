// kopytko-roku-device — Roku device communication toolkit.
//
// Everything the Kopytko ecosystem uses to talk to a Roku device:
//   - SSDP discovery (UDP 1900)
//   - ECP REST client + registry/tracing helpers (HTTP 8060, digest auth on 80)
//   - SceneGraph debug console client (TCP 8080)
//   - Interactive debug console streaming + command catalog (TCP 8085 + 8080)
//   - BrightScript remote debug protocol (TCP 8081 + dynamic IO port)
//   - Diagnostics parsers + polling collectors (chanperf, sgnodes, textures, …)
//   - RALE TrackerTask client — live SceneGraph node editing (dynamic TCP port)
//   - Perfetto trace streaming (WebSocket on 8060)
//   - Developer web-admin automation — install/rekey/package/screenshot/reboot (HTTP 80)
//
// Deliberately Kopytko-ecosystem-unaware: no CLI spawning, no .kopytkorc
// knowledge — so kopytko packages themselves can depend on it.

// Shared device types
export * from './types';

// Low-level networking
export {
  httpGet,
  httpGetBuffer,
  httpPost,
  httpPostMultipartDigest,
  httpGetBufferDigest,
  buildMultipartBody,
  parseDigestChallenge,
  buildDigestAuthHeader,
  type HttpGetResponse,
  type HttpBufferResponse,
  type MultipartField,
} from './net/httpClient';
export { computeNetworkId } from './net/networkId';

// SSDP discovery
export { SsdpClient } from './ssdp/ssdpClient';

// Device discovery orchestration
export {
  DeviceManager,
  type DeviceManagerOptions,
  type DeviceStorage,
  type NetworkWatcher,
  type NetworkWatcherEvents,
} from './discovery/deviceManager';

// ECP (External Control Protocol)
export {
  EcpClient,
  parseAppsXml,
  parseActiveAppXml,
  parseMediaPlayerXml,
  buildEcpQueryString,
  type ActiveAppInfo,
  type MediaPlayerInfo,
  type RendezvousEvent as EcpRendezvousEvent,
  type FwBeaconEcpEvent,
} from './ecp/ecpClient';
export {
  EcpKeys,
  LIT_PREFIX,
  isValidEcpKey,
  charToLitKey,
  textToLitKeys,
  type EcpKey,
} from './ecp/keys';
export { parseRegistryXml, type RegistryData, type RegistrySection } from './ecp/registry';
export { enablePerfettoTracing, triggerHeapSnapshot } from './ecp/tracing';

// Developer web-admin automation (Installer/Utilities/Packager/Update tabs, port 80)
export { InstallerClient } from './installer/installerClient';

// SceneGraph debug console (port 8080)
export {
  DebugConsoleClient,
  type ConsoleSocket,
  type ConsoleSocketFactory,
  type DebugConsoleOptions,
} from './console/debugConsoleClient';

// Interactive debug consoles (ports 8085 + 8080) — raw streaming transport
export {
  ConsoleStream,
  CONSOLE_PORTS,
  type ConsolePort,
  type ConsoleStreamOptions,
} from './console/consoleStream';
export {
  CONSOLE_COMMANDS,
  CONSOLE_PORT_LABELS,
  completeCommand,
  findCommand,
  isDestructiveCommand,
  type ConsoleCommandSpec,
  type ConsoleSubcommandSpec,
  type ConsoleCompletion,
} from './console/commandCatalog';

// Diagnostics event model, parsers, and collectors
export * from './diagnostics/eventModel';
export * from './diagnostics/parsers';
export * from './diagnostics/collectors';

// BrightScript remote debug protocol (port 8081)
export * from './debug-protocol/constants';
export * from './debug-protocol/types';
export { BinaryReader, BinaryWriter } from './debug-protocol/binaryIO';
export {
  ProtocolClient,
  RequestCancelledError,
  isRequestCancelled,
  type ProtocolClientEvents,
  type ProtocolTracer,
} from './debug-protocol/protocolClient';
export { IOClient } from './debug-protocol/ioClient';
export { DebugCommands } from './debug-protocol/commands';

// RALE TrackerTask client (live SceneGraph editing; dynamic TCP port)
export { encodeRequest, FrameDecoder, type RaleFrame } from './rale/frame';
export {
  RaleTrackerClient,
  type RaleEcpInput,
  type RaleInitInfo,
  type RaleItemList,
  type RaleNodeData,
  type RaleNodeItem,
  type RalePathSegment,
  type RaleSelectNodeResult,
  type RaleSocket,
  type RaleSocketFactory,
  type RaleTrackerOptions,
} from './rale/raleTrackerClient';

// Perfetto trace streaming
export { PerfettoWebSocketClient } from './perfetto/webSocketClient';
