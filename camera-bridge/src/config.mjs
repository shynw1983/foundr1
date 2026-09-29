import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function loadConfig() {
  const cameraPath = path.resolve(process.env.FOUNDR1_CAMERA_CONFIG || path.join(root, 'config.local.json'));
  const camera = JSON.parse(await readFile(cameraPath, 'utf8'));
  const bridgePath = path.resolve(path.dirname(cameraPath), camera.desktopBridgeConfig || '../desktop-bridge/config.local.json');
  const bridge = JSON.parse(await readFile(bridgePath, 'utf8'));
  const origin = new URL(bridge.serverUrl || 'https://www.foundr1.jp');
  const local = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !local || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('invalid_server_origin');
  if (!/^[a-f0-9-]{36}$/i.test(bridge.storeId) || typeof bridge.bridgeToken !== 'string' || !bridge.bridgeToken) throw new Error('bridge_credentials_missing');
  const cameraBindings = camera.cameraBindings || {};
  if (!Object.entries(cameraBindings).length || Object.entries(cameraBindings).some(([id, serial]) => !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id) || typeof serial !== 'string' || !/^T8170[A-Z0-9_-]{6,40}$/i.test(serial))) throw new Error('camera_bindings_missing');
  return { serverUrl: origin.origin, storeId: bridge.storeId, bridgeToken: bridge.bridgeToken, cameraBindings, countryCode: camera.countryCode || 'JP', cameraPath };
}
