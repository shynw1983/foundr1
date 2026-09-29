import { createInterface } from 'node:readline/promises';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, loadConfig } from './config.mjs';
import { keychain } from './keychain.mjs';
import { CameraWorker } from './worker-client.mjs';

function hidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run setup in an interactive terminal.');
  process.stdout.write(prompt); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const end = () => { process.stdin.off('data', input); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const input = buffer => {
      for (const c of buffer.toString()) {
        if (c === '\u0003') { end(); reject(new Error('cancelled')); return; }
        if (c === '\r' || c === '\n') { end(); resolve(value); return; }
        if (c === '\x7f' || c === '\b') value = value.slice(0, -1); else value += c;
      }
    };
    process.stdin.on('data', input);
  });
}
async function question(text) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await prompt.question(text)).trim(); } finally { prompt.close(); }
}
const config = await loadConfig();
const checkOnly = process.argv.includes('--check-only');
let session, worker;
try {
  const email = await question('eufy 邮箱: '), password = await hidden('eufy 密码（不显示）: ');
  worker = new CameraWorker(value => { session = value; });
  await worker.request('initialize', { credentials: { email, password, countryCode: config.countryCode } }, 5000);
  let auth = await worker.request('login');
  for (let attempt = 0; auth.status !== 'ok' && attempt < 3; attempt++) {
    if (auth.status === '2fa') auth = await worker.request('verify', { value: await question('邮箱验证码: ') });
    else if (auth.status === 'captcha') {
      const raw = String(auth.image).replace(/^data:image\/(?:png|jpeg);base64,/, '');
      if (!/^[A-Za-z0-9+/=\s]+$/.test(raw) || raw.length > 2_000_000) throw new Error('login_required');
      await mkdir(path.join(root, '.runtime'), { recursive: true, mode: 0o700 });
      const file = path.join(root, '.runtime/captcha.png');
      await writeFile(file, Buffer.from(raw, 'base64'), { mode: 0o600 });
      console.log(`图片验证码：${file}`);
      auth = await worker.request('captcha', { value: await question('图片中的文字: ') });
    } else throw new Error('login_required');
  }
  if (auth.status !== 'ok') throw new Error('login_required');
  const cameras = await worker.request('roster');
  if (!cameras.length) throw new Error('No SoloCam S340 found.');
  cameras.forEach((camera, index) => console.log(`${index + 1}. ${camera.name} (${camera.model})`));
  const index = cameras.length === 1 ? 0 : Number(await question('摄像头序号: ')) - 1;
  if (!cameras[index]) throw new Error('Invalid camera selection.');
  const id = Object.keys(config.cameraBindings)[0];
  const result = await worker.request('capture', { serial: cameras[index].serial });
  console.log(JSON.stringify({ capturedAt: result.capturedAt, bytes: result.bytes, connectionMs: result.connectionMs, fragments: result.fragments }));
  if (!checkOnly) {
    const answer = await question('将此账号和会话保存到本机钥匙串，供 Store 按需查看？输入 yes 确认: ');
    if (answer !== 'yes') throw new Error('cancelled');
    await keychain('write', config.storeId, 'credentials', { email, password });
    await keychain('write', config.storeId, 'session', session);
    const source = JSON.parse(await readFile(config.cameraPath, 'utf8'));
    source.cameraBindings[id] = cameras[index].serial;
    await writeFile(config.cameraPath, JSON.stringify(source, null, 2) + '\n', { mode: 0o600 });
    await chmod(config.cameraPath, 0o600);
    console.log('已保存到本机钥匙串。未向 Foundr1 上传 eufy 登录资料。');
  }
} catch (error) {
  console.error(['cancelled', 'login_required', 'timeout', 'too_large'].includes(error.message) ? error.message : 'Camera setup did not complete.');
  process.exitCode = 1;
} finally { worker?.close(); }
