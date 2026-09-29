import { spawn } from 'node:child_process';
import { root } from './config.mjs';
import path from 'node:path';

export function keychain(operation, storeId, account, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, '.runtime/keychain'), [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', settled = false;
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('login_required')); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(); }, 15_000);
    child.on('error', fail); child.stdin.on('error', fail);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', text => { output += text; if (output.length > 100_000) { child.kill(); fail(); } });
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return fail();
      try { const result = JSON.parse(output); settled = true; clearTimeout(timer); resolve(result); } catch { fail(); }
    });
    child.stdin.end(JSON.stringify({ operation, storeId, account, value }));
  });
}
