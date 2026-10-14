import assert from "node:assert/strict";
import test from "node:test";
import { pickupVoicePhrases } from "../../lib/pickup-voice.ts";
import { assembleVoicePack, pcmWav, readPcmWav, renderPreview, trimPcm } from "../generate-pickup-voice.mjs";

function segment() {
  const pcm = Buffer.alloc(4800 * 2);
  for (let i = 1400; i < 3400; i++) pcm.writeInt16LE(i % 2 ? 1000 : -1000, i * 2);
  return pcmWav(pcm);
}

test("WAV processing preserves PCM, rejects truncation and silent synthesis", () => {
  const wav = segment();
  assert.deepEqual(pcmWav(readPcmWav(wav)), wav);
  assert.throws(() => readPcmWav(wav.subarray(0, -1)), /Truncated/);
  assert.throws(() => trimPcm(Buffer.alloc(2000)), /Silent/);
  const bad = Buffer.from(wav); bad.writeUInt32LE(48000, 24);
  assert.throws(() => readPcmWav(bad), /24 kHz/);
  assert.ok(trimPcm(readPcmWav(wav)).length < readPcmWav(wav).length);
});

test("pack is reproducible and version changes with voice/content; preview is a complete WAV", () => {
  const parts = Object.fromEntries(Object.keys(pickupVoicePhrases).map((token) => [token, segment()]));
  const pack = assembleVoicePack(parts, "voice-a");
  assert.equal(pack.manifest.version, assembleVoicePack(parts, "voice-a").manifest.version);
  assert.notEqual(pack.manifest.version, assembleVoicePack(parts, "voice-b").manifest.version);
  const samples = readPcmWav(pack.wav).length / 2;
  for (const clip of Object.values(pack.manifest.clips)) assert.ok(clip.offset + clip.duration <= samples / 24000 + 0.0001);
  assert.ok(readPcmWav(renderPreview(pack)).length > 1000);
  delete parts.P;
  assert.throws(() => assembleVoicePack(parts, "voice-a"), /Missing/);
});
