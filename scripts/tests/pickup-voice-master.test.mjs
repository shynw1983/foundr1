import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pickupVoicePhrases } from "../../lib/pickup-voice.ts";
import { pcmWav, readPcmWav } from "../generate-pickup-voice.mjs";
import { splitMaster } from "../split-pickup-voice-master.mjs";

test("all clips come from the specified master and preserve their exact samples", () => {
  const pcm = Buffer.alloc(39 * 4800);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(i % 30000, i * 2);
  const wav = pcmWav(pcm);
  const cues = { sha256: createHash("sha256").update(wav).digest("hex"), clips: {} };
  Object.keys(pickupVoicePhrases).forEach((token, i) => { cues.clips[token] = { start: i / 10, end: (i + 1) / 10 }; });
  const parts = splitMaster(wav, cues);
  assert.equal(Object.keys(parts).length, 39);
  assert.deepEqual(Buffer.concat(Object.values(parts).map(readPcmWav)), pcm);
  assert.throws(() => splitMaster(wav, { ...cues, sha256: "other" }), /does not match/);
  const missing = structuredClone(cues); delete missing.clips.P;
  assert.throws(() => splitMaster(wav, missing), /39 master cues/);
  const overlap = structuredClone(cues); overlap.clips.P.start = overlap.clips.O.start;
  assert.throws(() => splitMaster(wav, overlap), /Overlapping/);
  const outside = structuredClone(cues); outside.clips.P.end = 100;
  assert.throws(() => splitMaster(wav, outside), /Invalid master cue/);
});
