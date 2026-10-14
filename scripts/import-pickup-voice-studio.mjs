// Import reviewed, individually named AI Studio WAV segments. No credentials needed.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { pickupVoicePhrases, validatePickupVoiceManifest } from "../lib/pickup-voice.ts";
import { assembleVoicePack, renderPreview } from "./generate-pickup-voice.mjs";

const source = process.argv[2];
if (!source || process.argv.length !== 3) throw new Error("Usage: node scripts/import-pickup-voice-studio.mjs <reviewed-segments-directory>");
const parts = {};
const provenance = JSON.parse(await readFile(join(resolve(source), "provenance.json"), "utf8"));
if (!/^[a-f0-9]{64}$/.test(provenance.masterSha256) || Object.keys(provenance.clips || {}).length !== 39) {
  throw new Error("A complete single-master provenance record is required");
}
for (const token of Object.keys(pickupVoicePhrases)) parts[token] = await readFile(join(resolve(source), `${token}.wav`));
for (const [token, wav] of Object.entries(parts)) {
  if (createHash("sha256").update(wav).digest("hex") !== provenance.clips[token]) throw new Error(`Master provenance mismatch: ${token}`);
}
const pack = assembleVoicePack(parts, "Google AI Studio: Erinome (gemini-2.5-flash-preview-tts)");
pack.manifest.masterSha256 = provenance.masterSha256;
validatePickupVoiceManifest(pack.manifest);
const output = resolve("public/audio/pickup");
await mkdir(output, { recursive: true });
await writeFile(join(output, `voice-${pack.manifest.version}.wav`), pack.wav);
for (const code of ["P-1204", "M-0007", "N-8899", "DC543"]) await writeFile(join(output, `preview-${code}.wav`), renderPreview(pack, code));
await writeFile(join(output, "manifest.json.tmp"), JSON.stringify(pack.manifest, null, 2) + "\n");
await rename(join(output, "manifest.json.tmp"), join(output, "manifest.json"));
console.log(`Imported ${Object.keys(parts).length} Erinome clips: ${pack.manifest.version}`);
