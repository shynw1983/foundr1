import { EufyMega } from '@mega-yfue/eufy-sdk';

export const MAX_CLIP_BYTES = 3_500_000;
const noop = () => {};
export class CameraError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function publicCode(error) {
  if (error instanceof CameraError) return error.code;
  const name = error?.constructor?.name || error?.name || '';
  if (/SessionExpired|Authentication|Login|Captcha|Verification/.test(name)) return 'login_required';
  if (error?.name === 'AbortError') return 'cancelled';
  return 'unavailable';
}

export class EufyCamera {
  constructor(credentials, session, onSession, Client = EufyMega) {
    this.session = session || null;
    this.client = new Client({
      ...credentials, autoRealtime: false, pollMs: 0, prewarmEvents: [], prewarmMs: 0, p2pIdleMs: 1000, storedSnapshotCache: false,
      store: { load: () => this.session, save: value => { this.session = value; onSession(value); }, clear: () => { this.session = null; onSession(null); } },
      logger: { debug: noop, info: noop, warn: noop, error: noop },
    });
    this.client.on('error', noop);
    this.active = null;
  }
  async login() { return this.client.login({ messageType: 2 }); }
  async verify(code) { return this.client.submitVerifyCode(code); }
  async captcha(answer) { return this.client.solveCaptcha(answer, { messageType: 2 }); }
  async roster() {
    const devices = await this.client.getDevices();
    return devices.filter(d => /^T8170/i.test(d.model || '') || /^T8170/i.test(d.sn || '')).map(d => ({ serial: d.sn, name: d.name || 'SoloCam S340', model: d.model || 'T8170' }));
  }
  async capture(serial, { durationMs = 10_000, deadlineMs = 35_000, maxBytes = MAX_CLIP_BYTES } = {}) {
    if (this.active) throw new CameraError('busy');
    if (!/^T8170[A-Z0-9_-]{6,40}$/i.test(serial)) throw new CameraError('unavailable');
    const controller = new AbortController(); this.active = controller;
    let handle, stopTimer, deadline, timedOut = false;
    try {
      const login = await this.login();
      if (login.status !== 'ok') throw new CameraError('login_required');
      const roster = await this.roster();
      if (!roster.some(d => d.serial === serial)) throw new CameraError('unavailable');
      const device = await this.client.getDevice(serial), camera = device.camera?.();
      if (!camera?.recordFragments) throw new CameraError('unavailable');
      const startedAt = Date.now();
      handle = camera.recordFragments({ fragmentSeconds: 1, powered: 'battery', preBufferSeconds: 0, signal: controller.signal });
      deadline = setTimeout(() => { timedOut = true; controller.abort(); handle.stop(); }, deadlineMs);
      let capturedAt = null, initCount = 0, fragments = 0, bytes = 0;
      const chunks = [];
      for await (const fragment of handle) {
        if (!capturedAt) { capturedAt = Date.now(); stopTimer = setTimeout(() => handle.stop(), durationMs); }
        if (fragment.init?.length) { initCount++; if (initCount > 1) throw new CameraError('unavailable'); chunks.push(fragment.init); bytes += fragment.init.length; }
        if (fragment.data?.length) { chunks.push(fragment.data); bytes += fragment.data.length; fragments++; }
        if (bytes > maxBytes) throw new CameraError('too_large');
      }
      if (timedOut) throw new CameraError('timeout');
      if (controller.signal.aborted) throw new CameraError('cancelled');
      if (initCount !== 1 || fragments === 0 || !capturedAt) throw new CameraError('unavailable');
      return { clip: Buffer.concat(chunks), capturedAt: new Date(capturedAt).toISOString(), connectionMs: capturedAt - startedAt, bytes, fragments };
    } finally {
      clearTimeout(stopTimer); clearTimeout(deadline); handle?.stop(); controller.abort();
      try { await this.client.disconnect(); } finally { this.active = null; }
    }
  }
  async close() { this.active?.abort(); await this.client.disconnect(); }
}
