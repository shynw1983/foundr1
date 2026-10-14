import assert from "node:assert/strict";
import test from "node:test";
import { pickupVoicePhrases, pickupVoiceTokens, pickupVoiceFallbackText, pickupVoiceSchedule, validatePickupVoiceManifest, type PickupVoiceManifest } from "./pickup-voice.ts";

function manifest(): PickupVoiceManifest {
  return { version: "0123456789abcdef", audio: "/audio/pickup/voice-0123456789abcdef.wav", language: "ja-JP", voice: "test",
    clips: Object.fromEntries(Object.keys(pickupVoicePhrases).map((token, i) => [token, { offset: i, duration: 0.5 }])) };
}

test("letters, zero and repeated digits preserve the displayed identifier", () => {
  assert.deepEqual(pickupVoiceTokens(" p-0011 "), ["prefix", "P", "0", "0", "1", "1", "suffix"]);
  assert.deepEqual(pickupVoiceTokens("DC543"), ["prefix", "D", "C", "5", "4", "3", "suffix"]);
  assert.match(pickupVoiceFallbackText("P-0047"), /ピー、ゼロ、ゼロ、よん、なな/);
  for (const code of ["", "P/123", "P-", "P--123", "P😀1", "P".repeat(25)]) assert.throws(() => pickupVoiceTokens(code));
});

test("schedule spaces digits and phrases without overlapping source segments", () => {
  const schedule = pickupVoiceSchedule(pickupVoiceTokens("P-0011"), manifest(), 10);
  assert.equal(schedule[0].when, 10);
  assert.equal(schedule.length, 7);
  assert.equal(schedule[2].offset, schedule[3].offset);
  schedule.slice(1).forEach((clip, i) => assert.ok(clip.when > schedule[i].when + schedule[i].duration));
  assert.throws(() => pickupVoiceSchedule(["missing"], manifest(), 0));
});

test("incomplete, invalid and external voice packs are rejected before playback", () => {
  assert.equal(validatePickupVoiceManifest(manifest()).language, "ja-JP");
  for (const mutate of [
    (m: PickupVoiceManifest) => { m.audio = "https://example.com/audio.wav"; },
    (m: PickupVoiceManifest) => { delete m.clips.P; },
    (m: PickupVoiceManifest) => { m.clips.P.offset = -1; },
    (m: PickupVoiceManifest) => { m.clips.P.duration = NaN; },
    (m: PickupVoiceManifest) => { m.clips.P.duration = 0; }
  ]) { const m = manifest(); mutate(m); assert.throws(() => validatePickupVoiceManifest(m)); }
});

test("free VOICEVOX packs require attribution before they can play", () => {
  const m = manifest(); m.voice = "VOICEVOX:四国めたん";
  assert.throws(() => validatePickupVoiceManifest(m), /credit/);
  m.credit = "VOICEVOX:四国めたん";
  assert.equal(validatePickupVoiceManifest(m).credit, m.credit);
});


test("optional chime requires a valid source range", () => {
  const m = manifest(); m.clips.chime = { offset: 30, duration: 1.3 };
  assert.equal(validatePickupVoiceManifest(m).clips.chime.duration, 1.3);
  m.clips.chime.offset = -1;
  assert.throws(() => validatePickupVoiceManifest(m));
});
