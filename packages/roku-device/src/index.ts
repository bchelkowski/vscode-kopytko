// kopytko-roku-device — Roku device communication toolkit.
//
// Everything the Kopytko ecosystem uses to talk to a Roku device:
//   - SSDP discovery (UDP 1900)
//   - ECP REST client + registry/tracing helpers (HTTP 8060, digest auth on 80)
//   - SceneGraph debug console client (TCP 8080)
//   - BrightScript remote debug protocol (TCP 8081 + dynamic IO port)
//   - Diagnostics parsers + polling collectors (chanperf, sgnodes, textures, …)
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
  buildEcpQueryString,
  type RendezvousEvent as EcpRendezvousEvent,
  type FwBeaconEcpEvent,
} from './ecp/ecpClient';
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

// Diagnostics event model, parsers, and collectors
export * from './diagnostics/eventModel';
export * from './diagnostics/parsers';
export * from './diagnostics/collectors';

// BrightScript remote debug protocol (port 8081)
export * from './debug-protocol/constants';
export * from './debug-protocol/types';
export { BinaryReader, BinaryWriter } from './debug-protocol/binaryIO';
export { ProtocolClient, type ProtocolClientEvents } from './debug-protocol/protocolClient';
export { IOClient } from './debug-protocol/ioClient';
export { DebugCommands } from './debug-protocol/commands';

// Perfetto trace streaming
export { PerfettoWebSocketClient } from './perfetto/webSocketClient';
