// kopytko-roku-device — Roku device communication toolkit.
//
// Everything the Kopytko ecosystem uses to talk to a Roku device:
//   - SSDP discovery (UDP 1900)
//   - ECP REST client + registry/tracing helpers (HTTP 8060, digest auth on 80)
//   - SceneGraph debug console client (TCP 8080)
//   - BrightScript remote debug protocol (TCP 8081 + dynamic IO port)
//   - Diagnostics parsers + polling collectors (chanperf, sgnodes, textures, …)
//   - Perfetto trace streaming (WebSocket on 8060)
//   - Sideload deployment via the Kopytko CLI

// Shared device types
export * from './types';

// Low-level networking
export {
  httpGet,
  httpPost,
  parseDigestChallenge,
  buildDigestAuthHeader,
  type HttpGetResponse,
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
  type RendezvousEvent as EcpRendezvousEvent,
  type FwBeaconEcpEvent,
} from './ecp/ecpClient';
export { parseRegistryXml, type RegistryData, type RegistrySection } from './ecp/registry';
export { enablePerfettoTracing, triggerHeapSnapshot } from './ecp/tracing';

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

// Sideload deployment
export {
  deploy,
  deployForPerfetto,
  upload,
  type DeployOptions,
  type PerfettoDeployOptions,
} from './deploy/rokuDeployer';

// Project configuration
export { getAvailableEnvironments } from './config/kopytkorc';
