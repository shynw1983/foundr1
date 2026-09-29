const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const allowedErrors = new Set(['unavailable', 'busy', 'login_required', 'timeout', 'too_large', 'cancelled']);

export class CameraJobs {
  constructor({ storeId, cameraBindings, capture, upload, failure, remove, now = () => Date.now() }) {
    Object.assign(this, { storeId, cameraBindings, capture, upload, failure, remove, now });
    this.seen = new Map(); this.active = null; this.lastStarted = 0;
  }
  prune() { for (const [id, until] of this.seen) if (until <= this.now()) this.seen.delete(id); }
  async start(job) {
    this.prune();
    if (!job || job.storeId !== this.storeId || !uuid.test(job.requestId) || !Object.hasOwn(this.cameraBindings, job.cameraId)
      || typeof job.ticket !== 'string' || job.ticket.length > 2048 || !Number.isFinite(job.deadline)
      || job.deadline <= this.now() || job.deadline > this.now() + 95_000 || this.seen.has(job.requestId)) return;
    if (this.seen.size >= 200) return;
    this.seen.set(job.requestId, this.now() + 5 * 60_000);
    if (this.active || this.now() - this.lastStarted < 10_000) { await this.failure(job, 'busy').catch(() => {}); return; }
    this.lastStarted = this.now();
    const controller = new AbortController(), active = { job, controller };
    this.active = active;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(70_000, job.deadline - this.now()));
    try {
      const result = await this.capture(this.cameraBindings[job.cameraId], controller.signal);
      if (controller.signal.aborted || this.now() >= job.deadline) throw new Error('cancelled');
      await this.upload(job, result, controller.signal);
      if (controller.signal.aborted) await this.remove(job).catch(() => {});
    } catch (error) {
      await this.failure(job, timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : allowedErrors.has(error.message) ? error.message : 'unavailable').catch(() => {});
    } finally { clearTimeout(timeout); if (this.active === active) this.active = null; }
  }
  cancel(event) {
    this.prune();
    if (!event || !uuid.test(event.requestId) || !Object.hasOwn(this.cameraBindings, event.cameraId)) return;
    if (this.seen.size < 200) this.seen.set(event.requestId, this.now() + 5 * 60_000);
    if (this.active?.job.requestId === event.requestId) this.active.controller.abort();
  }
  stop() { this.active?.controller.abort(); }
}
