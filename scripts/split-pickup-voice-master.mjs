// Split reviewed cues from ONE recording; never combine independently generated voices.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { pickupVoicePhrases } from "../lib/pickup-voice.ts";
import { readPcmWav, pcmWav } from "./generate-pickup-voice.mjs";

export function splitMaster(wav, cues) {
  const digest = createHash("sha256").update(wav).digest("hex");
  if (cues.sha256 !== digest) throw new Error("Cue sheet does not match the master recording");
  const pcm = readPcmWav(wav);
  const tokens = Object.keys(pickupVoicePhrases);
  if (!cues.clips || Object.keys(cues.clips).length !== tokens.length) throw new Error("Expected all 39 master cues");
  const intervals = [];
  const parts = {};
  for (const token of tokens) {
    const cue = cues.clips[token];
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < 0 || cue.end <= cue.start || cue.end > pcm.length / 48000
      || cue.end - cue.start > 30) throw new Error(`Invalid master cue: ${token}`);
    intervals.push({ token, ...cue });
    parts[token] = pcmWav(pcm.subarray(Math.round(cue.start * 24000) * 2, Math.round(cue.end * 24000) * 2));
  }
  intervals.sort((a, b) => a.start - b.start);
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].start < intervals[i - 1].end) throw new Error("Overlapping master cues");
  }
  return parts;
}

async function main() {
  if (process.argv.length !== 5) throw new Error("Usage: node scripts/split-pickup-voice-master.mjs <master.wav> <cues.json> <segments-directory>");
  const parts = splitMaster(await readFile(resolve(process.argv[2])), JSON.parse(await readFile(resolve(process.argv[3]), "utf8")));
  const output = resolve(process.argv[4]);
  await mkdir(output, { recursive: true });
  for (const [token, wav] of Object.entries(parts)) await writeFile(join(output, `${token}.wav`), wav);
  await writeFile(join(output, "provenance.json"), JSON.stringify({
    masterSha256: createHash("sha256").update(await readFile(resolve(process.argv[2]))).digest("hex"),
    clips: Object.fromEntries(Object.entries(parts).map(([token, wav]) => [token, createHash("sha256").update(wav).digest("hex")]))
  }, null, 2) + "\n");
  console.log(`Split ${Object.keys(parts).length} clips from a single verified master recording.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
