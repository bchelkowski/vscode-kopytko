export interface RokuDevice {
  ip: string;
  port: number;
  friendlyName: string;
  modelName: string;
  serialNumber: string;
  softwareVersion: string;
}

export interface RokuLaunchConfig {
  type: string;
  request: string;
  name: string;
  host: string;
  password: string;
  rootDir: string;
  stopOnEntry?: boolean;
}
