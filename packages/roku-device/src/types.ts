export type DeviceState = 'unknown' | 'pending' | 'online' | 'offline';
export type DeviceSource = 'discovered' | 'manual';

export interface RokuDevice {
  /** ECP `device-id` field (WiFi MAC address) — primary persistent identifier. */
  deviceId: string;
  ip: string;
  port: number;
  serialNumber: string;
  friendlyName: string;
  modelName: string;
  modelNumber: string;
  softwareVersion: string;
  state: DeviceState;
  source: DeviceSource;
  isFavorite: boolean;
  developerEnabled?: boolean;
  isTV?: boolean;
  lastSeen: number;
  deviceInfo?: Record<string, string>;
}

export interface StoredDevice {
  /** ECP `device-id` field — primary persistent identifier. */
  deviceId?: string;
  serialNumber: string;
  ip: string;
  port: number;
  friendlyName: string;
  modelName: string;
  modelNumber: string;
  isFavorite: boolean;
  lastSeen: number;
  deviceInfo?: Record<string, string>;
}

export interface RokuApp {
  id: string;
  name: string;
  type?: string;
  version?: string;
}

export interface SsdpDeviceFound {
  ip: string;
  port: number;
  serialNumber: string;
}

export interface RokuLaunchConfig {
  type: string;
  request: string;
  name: string;
  host: string;
  password: string;
  rootDir: string;
  env?: string;
  stopOnEntry?: boolean;
}
