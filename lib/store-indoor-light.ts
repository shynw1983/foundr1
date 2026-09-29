// Compatibility for already-loaded Store clients. Both endpoints share one journal/lock.
import { getStoreDevices, requestStoreDeviceCommand, StoreDeviceError } from "./store-devices";
import { deviceKey, indoorLightConfig } from "./switchbot";
import { estimateIndoorLight, type IndoorLightView } from "./store-light-state";
export { StoreDeviceError as IndoorLightError };
export async function getIndoorLight(storeId: string): Promise<IndoorLightView> {
  const empty: IndoorLightView = { configured: false, storeId, sample: null, fetchedAt: null, estimate: "unknown", readError: false, canPress: false, controlEnabled: false, blockedUntil: null, command: null, offMax: 3, onMin: 10 };
  const config = indoorLightConfig(storeId);
  if (!config) return empty;
  const view = await getStoreDevices(storeId, deviceKey(storeId, config.botId)), device = view.devices[0];
  const c = device.command;
  return { ...empty, configured: true, sample: device.sample ? { lightLevel: device.sample.lightLevel!, battery: device.sample.battery ?? null, botMode: device.sample.botMode || "" } : null,
    fetchedAt: device.fetchedAt, estimate: device.readError ? "unknown" : estimateIndoorLight(device.sample?.lightLevel, device.fetchedAt), readError: device.readError,
    controlEnabled: device.controlEnabled, canPress: device.controlEnabled && !device.readError && (!device.blockedUntil || Date.parse(device.blockedUntil) <= Date.now()), blockedUntil: device.blockedUntil,
    command: c ? { id: c.id, result: c.result, requestedAt: c.requestedAt, finishedAt: c.finishedAt, beforeState: estimateIndoorLight(c.before?.lightLevel, new Date().toISOString()), reason: c.reason } : null };
}
export async function requestIndoorLightPress(storeId: string, actorId: string, requestId: string) {
  const config = indoorLightConfig(storeId);
  if (!config) throw new StoreDeviceError("照明の操作はまだ有効になっていません。", 409);
  const { command } = await requestStoreDeviceCommand(storeId, actorId, deviceKey(storeId, config.botId), requestId, "press", "default");
  return { id: command.id, result: command.result, requestedAt: command.requestedAt, finishedAt: command.finishedAt, beforeState: estimateIndoorLight(command.before?.lightLevel, new Date().toISOString()), reason: command.reason };
}
