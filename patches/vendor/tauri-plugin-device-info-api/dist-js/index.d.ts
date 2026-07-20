import type {
  DeviceInfoResponse,
  BatteryInfo,
  NetworkInfo,
  StorageInfo,
  DisplayInfo,
} from './type';
export type {
  DeviceInfoResponse,
  DeviceInfoResponse as DeviceInfo,
  BatteryInfo,
  NetworkInfo,
  StorageInfo,
  DisplayInfo,
} from './type';
/**
 * Get comprehensive device information including UUID, manufacturer, model, etc.
 */
export declare function getDeviceInfo(): Promise<DeviceInfoResponse>;
/**
 * Get battery status including level, charging state, and health.
 */
export declare function getBatteryInfo(): Promise<BatteryInfo>;
/**
 * Get network information including IP address, network type, and MAC address.
 */
export declare function getNetworkInfo(): Promise<NetworkInfo>;
/**
 * Get storage information including total space, free space, and storage type.
 */
export declare function getStorageInfo(): Promise<StorageInfo>;
/**
 * Get display information including resolution, scale factor, and refresh rate.
 */
export declare function getDisplayInfo(): Promise<DisplayInfo>;
