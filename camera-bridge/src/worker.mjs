import { EufyCamera, publicCode } from './eufy-camera.mjs';

let camera;
process.on('message', async ({ id, command, data }) => {
  try {
    let result;
    if (command === 'initialize' && !camera) {
      camera = new EufyCamera(data.credentials, data.session, session => { if (process.connected) process.send({ type: 'session', session }); });
      result = { initialized: true };
    } else if (camera && command === 'capture') result = await camera.capture(data.serial);
    else if (camera && command === 'roster') result = await camera.roster();
    else if (camera && ['login', 'verify', 'captcha'].includes(command)) {
      const auth = await camera[command](data.value);
      result = { status: auth.status, ...(auth.status === 'captcha' ? { image: auth.image } : {}) };
    } else throw new Error('invalid_action');
    if (process.connected) process.send({ id, result });
  } catch (error) { if (process.connected) process.send({ id, error: publicCode(error) }); }
});
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  setTimeout(() => process.exit(0), 1500).unref();
  try { await camera?.close(); } catch {}
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('disconnect', stop);
