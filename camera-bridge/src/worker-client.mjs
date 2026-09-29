import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export class CameraWorker {
  constructor(onSession = () => {}, workerPath = new URL('./worker.mjs', import.meta.url)) {
    this.child = fork(workerPath, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' } });
    this.pending = new Map(); this.closed = false;
    this.child.on('message', message => {
      if (message.type === 'session') { onSession(message.session); return; }
      const item = this.pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer); this.pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
    });
    this.child.on('error', () => this.close()); this.child.on('exit', () => this.close());
  }
  request(command, data = {}, timeout = 65_000) {
    if (this.closed) return Promise.reject(new Error('cancelled'));
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout')); this.close(); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.send({ id, command, data }, error => { if (error) this.close(); });
    });
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('cancelled')); }
    this.pending.clear(); this.child.kill('SIGTERM');
    setTimeout(() => this.child.kill('SIGKILL'), 2000).unref();
  }
}
