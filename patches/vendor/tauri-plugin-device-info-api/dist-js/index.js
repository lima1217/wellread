import { invoke } from '@tauri-apps/api/core';

/**
 * Get comprehensive device information including UUID, manufacturer, model, etc.
 */
async function getDeviceInfo() {
  return await invoke('plugin:device-info|get_device_info');
}
/**
 * Get battery status including level, charging state, and health.
 */
async function getBatteryInfo() {
  return await invoke('plugin:device-info|get_battery_info');
}
/**
 * Get network information including IP address, network type, and MAC address.
 */
async function getNetworkInfo() {
  return await invoke('plugin:device-info|get_network_info');
}
/**
 * Get storage information including total space, free space, and storage type.
 */
async function getStorageInfo() {
  return await invoke('plugin:device-info|get_storage_info');
}
/**
 * Get display information including resolution, scale factor, and refresh rate.
 */
async function getDisplayInfo() {
  return await invoke('plugin:device-info|get_display_info');
}

export { getBatteryInfo, getDeviceInfo, getDisplayInfo, getNetworkInfo, getStorageInfo };
