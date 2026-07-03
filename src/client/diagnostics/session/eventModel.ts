/**
 * Diagnostic event model.
 *
 * The event/sample type definitions live in `kopytko-roku-device` (they
 * describe device-reported data shapes); this module re-exports them and adds
 * the NDJSON storage mapping, which is an extension-side concern.
 */

export type {
  DiagnosticEventType,
  BaseEvent,
  MemCpuEvent,
  NodeCountsEvent,
  ObjectTypeEntry,
  ObjectCountsEvent,
  RendezvousEvent,
  SystemMemEvent,
  TextureBitmapEntry,
  TexturesEvent,
  AppStateEvent,
  FwBeaconEvent,
  DiagnosticEvent,
  DiagnosticSample,
} from 'kopytko-roku-device';

import type { DiagnosticEventType } from 'kopytko-roku-device';

/** Maps each event type to its NDJSON stream file name within a session folder. */
export const STREAM_FILE: Record<DiagnosticEventType, string> = {
  'mem-cpu': 'mem-cpu.ndjson',
  'node-counts': 'node-counts.ndjson',
  'object-counts': 'object-counts.ndjson',
  rendezvous: 'rendezvous.ndjson',
  'system-mem': 'system-mem.ndjson',
  textures: 'textures.ndjson',
  'app-state': 'app-state.ndjson',
  'fw-beacon': 'fw-beacon.ndjson',
};

export const ALL_EVENT_TYPES = Object.keys(STREAM_FILE) as DiagnosticEventType[];
