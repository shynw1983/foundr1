// One-time asset generation. No cloud credentials or synthesis code ships to the TV.
import { createHash, createSign } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pickupVoicePhrases, pickupVoiceSchedule } from "../lib/pickup-voice.ts";

const sampleRate = 24000;
const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

export function readPcmWav(wav) {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a PCM WAV response");
  }
  let format, pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4), start = offset + 8, end = start + size;
    if (end > wav.length) throw new Error("Truncated WAV");
    const type = wav.toString("ascii", offset, offset + 4);
    if (type === "fmt ") {
      if (size < 16) throw new Error("Invalid WAV format");
      format = [wav.readUInt16LE(start), wav.readUInt16LE(start + 2), wav.readUInt32LE(start + 4), wav.readUInt16LE(start + 14)];
    }
    if (type === "data") pcm = wav.subarray(start, end);
    offset = end + (size % 2);
  }
  if (JSON.stringify(format) !== JSON.stringify([1, 1, sampleRate, 16]) || !pcm?.length || pcm.length % 2) {
    throw new Error("Expected 24 kHz mono 16-bit PCM");
  }
  return pcm;
}

export function pcmWav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function trimPcm(pcm) {
  const samples = pcm.length / 2;
  // Trim only silent edges, retaining 40 ms around speech to preserve consonants.
  let first = 0, last = samples - 1;
  while (first < samples && Math.abs(pcm.readInt16LE(first * 2)) < 100) first++;
  while (last >= first && Math.abs(pcm.readInt16LE(last * 2)) < 100) last--;
  if (first === samples) throw new Error("Silent speech response");
  first = Math.max(0, first - 960); last = Math.min(samples - 1, last + 960);
  return Buffer.from(pcm.subarray(first * 2, (last + 1) * 2));
}

export function assembleVoicePack(parts, voice) {
  const clips = {}, buffers = [];
  let samples = 0;
  for (const token of Object.keys(pickupVoicePhrases)) {
    if (!parts[token]) throw new Error(`Missing speech segment: ${token}`);
    const pcm = trimPcm(readPcmWav(parts[token]));
    clips[token] = { offset: samples / sampleRate, duration: pcm.length / 2 / sampleRate };
    buffers.push(pcm); samples += pcm.length / 2;
  }
  const wav = pcmWav(Buffer.concat(buffers));
  const version = hash(Buffer.concat([Buffer.from(JSON.stringify({ clips, voice })), wav]));
  return { wav, manifest: { version, audio: `/audio/pickup/voice-${version}.wav`, language: "ja-JP", voice, clips } };
}

export function renderPreview(pack, code = "P-1204") {
  const tokens = ["prefix", ...code.replace(/-/g, ""), "suffix"];
  const schedule = pickupVoiceSchedule(tokens, pack.manifest, 0);
  const last = schedule.at(-1);
  const pcm = Buffer.alloc(Math.ceil((last.when + last.duration) * sampleRate) * 2);
  const source = readPcmWav(pack.wav);
  for (const clip of schedule) {
    const start = Math.round(clip.offset * sampleRate) * 2;
    source.subarray(start, start + Math.round(clip.duration * sampleRate) * 2).copy(pcm, Math.round(clip.when * sampleRate) * 2);
  }
  return pcmWav(pcm);
}

async function accessToken() {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to a Google service-account JSON file outside the repository.");
  const credentials = JSON.parse(await readFile(path, "utf8"));
  if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key || !credentials.project_id) {
    throw new Error("Expected a Google service-account credential file");
  }
  const issued = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: credentials.client_email, scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token", iat: issued, exp: issued + 3600
  })}`;
  const signature = createSign("RSA-SHA256").update(payload).sign(credentials.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${payload}.${signature}` }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`Google authentication failed (HTTP ${response.status})`);
  return { token: body.access_token, project: credentials.project_id };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--plan", "--voice"].includes(arg) && !arg.startsWith("ja-JP-Chirp3-HD-"))) {
    throw new Error("Usage: node scripts/generate-pickup-voice.mjs [--plan] [--voice ja-JP-Chirp3-HD-Kore]");
  }
  const voiceIndex = args.indexOf("--voice");
  const voice = voiceIndex >= 0 ? args[voiceIndex + 1] : "ja-JP-Chirp3-HD-Kore";
  if (!/^ja-JP-Chirp3-HD-[A-Za-z]+$/.test(voice ?? "")) throw new Error("Select a Japanese Chirp 3 HD voice");
  const entries = Object.entries(pickupVoicePhrases);
  console.log(`${entries.length} reusable clips; ${entries.reduce((n, [, text]) => n + [...text].length, 0)} source characters; voice ${voice}.`);
  if (args.includes("--plan")) return;
  const auth = await accessToken();
  const headers = { Authorization: `Bearer ${auth.token}`, "x-goog-user-project": auth.project, "Content-Type": "application/json" };
  const voicesResponse = await fetch("https://texttospeech.googleapis.com/v1/voices?languageCode=ja-JP", { headers, signal: AbortSignal.timeout(20_000) });
  if (!voicesResponse.ok) throw new Error(`Google voice listing failed (HTTP ${voicesResponse.status})`);
  const voices = await voicesResponse.json();
  if (!voices.voices?.some((item) => item.name === voice)) throw new Error(`Voice ${voice} is not available in this project`);
  const cacheDir = join(tmpdir(), "foundr1-pickup-voice", hash(JSON.stringify({ voice, sampleRate, entries })));
  await mkdir(cacheDir, { recursive: true });
  const parts = {};
  for (const [token, text] of entries) {
    const path = join(cacheDir, `${token}.wav`);
    try { const cached = await readFile(path); trimPcm(readPcmWav(cached)); parts[token] = cached; console.log(`${token}: cached`); continue; }
    catch { /* Missing/incomplete segments are regenerated; completed ones are reused. */ }
    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST", headers, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ input: { text }, voice: { languageCode: "ja-JP", name: voice }, audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: sampleRate } })
    });
    if (!response.ok) throw new Error(`Google synthesis failed for ${token} (HTTP ${response.status}); completed clips remain cached.`);
    const body = await response.json();
    if (typeof body.audioContent !== "string") throw new Error(`Missing audio for ${token}`);
    const wav = Buffer.from(body.audioContent, "base64");
    trimPcm(readPcmWav(wav)); parts[token] = wav;
    await writeFile(`${path}.tmp`, wav); await rename(`${path}.tmp`, path);
    console.log(`${token}: generated`);
  }
  const pack = assembleVoicePack(parts, voice);
  const output = resolve(fileURLToPath(new URL("../public/audio/pickup/", import.meta.url)));
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `voice-${pack.manifest.version}.wav`), pack.wav);
  await writeFile(join(output, "preview-P-1204.wav"), renderPreview(pack));
  await writeFile(join(output, "manifest.json.tmp"), JSON.stringify(pack.manifest, null, 2) + "\n");
  await rename(join(output, "manifest.json.tmp"), join(output, "manifest.json"));
  console.log(`Saved ${output}. Listen to preview-P-1204.wav before publishing.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
