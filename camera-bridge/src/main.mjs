import { Pusher } from 'pusher-js';
import { loadConfig } from './config.mjs';
import { keychain } from './keychain.mjs';
import { CameraWorker } from './worker-client.mjs';
import { CameraJobs } from './jobs.mjs';

const config = await loadConfig();
const endpoint = `${config.serverUrl}/api/local-bridge/cameras`;
async function request(body, { headers = {}, signal, raw = false } = {}) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${config.bridgeToken}`, 'Content-Type': raw ? 'video/mp4' : 'application/json', ...headers },
    body: raw ? body : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(response.status === 413 ? 'too_large' : 'unavailable');
  return response.json();
}
let worker, cleanupTimer, persist = Promise.resolve(), persistenceError = false, authBlockedUntil = 0;
const cleanup = () => request({ action: 'cleanup', storeId: config.storeId }).catch(() => {});
const jobs = new CameraJobs({
  storeId: config.storeId, cameraBindings: config.cameraBindings,
  async capture(serial, signal) {
    if (Date.now() < authBlockedUntil) throw new Error('login_required');
    const abort = () => { worker?.close(); worker = undefined; };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) throw new Error('cancelled');
      if (!worker || worker.closed) {
        const [credentials, session] = await Promise.all([keychain('read', config.storeId, 'credentials'), keychain('read', config.storeId, 'session')]);
        if (!credentials?.email || !credentials.password) throw new Error('login_required');
        if (signal.aborted) throw new Error('cancelled');
        persistenceError = false;
        worker = new CameraWorker(value => {
          persist = persist.then(() => keychain('write', config.storeId, 'session', value)).catch(() => { persistenceError = true; });
        });
        await worker.request('initialize', { credentials: { ...credentials, countryCode: config.countryCode }, session }, 5000);
      }
      const result = await worker.request('capture', { serial });
      await persist;
      if (persistenceError) throw new Error('login_required');
      return result;
    } catch (error) {
      if (error.message === 'login_required') { authBlockedUntil = Date.now() + 30 * 60_000; abort(); }
      throw error;
    } finally { signal.removeEventListener('abort', abort); }
  },
  async upload(job, result, signal) {
    await request(result.clip, { raw: true, signal, headers: { 'X-Camera-Action': 'upload', 'X-Camera-Ticket': job.ticket, 'X-Camera-Captured-At': result.capturedAt } });
    clearTimeout(cleanupTimer); cleanupTimer = setTimeout(cleanup, 6 * 60_000);
  },
  failure: (job, code) => request({ action: 'failure', ticket: job.ticket, code }),
  remove: job => request({ action: 'delete', ticket: job.ticket }),
});
const response = await fetch(`${endpoint}?storeId=${encodeURIComponent(config.storeId)}`, { headers: { Authorization: `Bearer ${config.bridgeToken}` }, signal: AbortSignal.timeout(25_000) });
if (!response.ok) throw new Error('camera_service_not_configured');
const realtime = await response.json();
if (!realtime.cameras?.every(c => Object.hasOwn(config.cameraBindings, c.id))) throw new Error('camera_bindings_mismatch');
const pusher = new Pusher(realtime.key, { cluster: realtime.cluster, forceTLS: true,
  channelAuthorization: { endpoint, transport: 'ajax', customHandler: async (params, callback) => {
    try { callback(null, await request({ action: 'realtime', storeId: config.storeId, socket_id: params.socketId, channel_name: params.channelName })); }
    catch { callback(new Error('camera_authorization_failed'), null); }
  } },
});
const channel = pusher.subscribe(realtime.channel);
channel.bind('camera.capture', job => { void jobs.start(job); });
channel.bind('camera.cancel', event => jobs.cancel(event));
channel.bind('pusher:subscription_succeeded', () => console.log('Camera Bridge connected.'));
channel.bind('pusher:subscription_error', () => console.error('Camera Bridge authorization unavailable.'));
pusher.connection.bind('error', () => console.error('Camera Bridge connection unavailable.'));
void cleanup();
async function stop() {
  jobs.stop(); worker?.close(); pusher.disconnect(); clearTimeout(cleanupTimer);
  await persist.catch(() => {}); process.exit(0);
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
