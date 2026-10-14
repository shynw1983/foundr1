// One reusable Japanese audio sprite; no speech API is called during store operation.
export const PICKUP_VOICE_MANIFEST_URL = "/audio/pickup/manifest.json";

export const pickupVoicePhrases: Record<string, string> = {
  prefix: "受付番号",
  suffix: "のお客様。商品ができあがりました。受取口までお越しください。",
  enabled: "音声案内を開始します。",
  "0": "ゼロ", "1": "いち", "2": "に", "3": "さん", "4": "よん",
  "5": "ご", "6": "ろく", "7": "なな", "8": "はち", "9": "きゅう",
  A: "エー", B: "ビー", C: "シー", D: "ディー", E: "イー", F: "エフ",
  G: "ジー", H: "エイチ", I: "アイ", J: "ジェー", K: "ケー", L: "エル",
  M: "エム", N: "エヌ", O: "オー", P: "ピー", Q: "キュー", R: "アール",
  S: "エス", T: "ティー", U: "ユー", V: "ブイ", W: "ダブリュー",
  X: "エックス", Y: "ワイ", Z: "ゼット"
};

export type PickupVoiceClip = { offset: number; duration: number };
export type PickupVoiceManifest = {
  version: string;
  audio: string;
  language: "ja-JP";
  voice: string;
  credit?: string;
  clips: Record<string, PickupVoiceClip>;
};

export function pickupVoiceTokens(code: string): string[] {
  const normalized = code.trim().toUpperCase();
  // Reject rather than silently announce a different identifier.
  if (!/^[A-Z0-9]+(?:[- ][A-Z0-9]+)*$/.test(normalized) || normalized.length > 24) {
    throw new Error("Unsupported pickup code");
  }
  return ["prefix", ...normalized.replace(/[- ]/g, ""), "suffix"];
}

export function pickupVoiceFallbackText(code: string): string {
  try {
    return pickupVoiceTokens(code).map((token) => pickupVoicePhrases[token]).join("、");
  } catch {
    return `番号 ${code}、準備できました。`;
  }
}

export function validatePickupVoiceManifest(value: unknown): PickupVoiceManifest {
  const manifest = value as PickupVoiceManifest;
  if (!manifest || manifest.language !== "ja-JP" || !/^[a-f0-9]{16}$/.test(manifest.version)
    || manifest.audio !== `/audio/pickup/voice-${manifest.version}.wav`
    || typeof manifest.voice !== "string" || !manifest.clips) {
    throw new Error("Invalid pickup voice manifest");
  }
  if (manifest.credit !== undefined && (typeof manifest.credit !== "string" || manifest.credit.length > 180)) {
    throw new Error("Invalid pickup voice credit");
  }
  if (manifest.voice.startsWith("VOICEVOX:") && !manifest.credit?.trim()) throw new Error("VOICEVOX credit is required");
  for (const token of new Set([...Object.keys(pickupVoicePhrases), ...Object.keys(manifest.clips)])) {
    const clip = manifest.clips[token];
    if (!clip || !Number.isFinite(clip.offset) || clip.offset < 0
      || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 30) {
      throw new Error(`Invalid pickup voice clip: ${token}`);
    }
  }
  return manifest;
}

export function pickupVoiceSchedule(tokens: string[], manifest: PickupVoiceManifest, start: number) {
  let next = start;
  return tokens.map((token) => {
    const clip = manifest.clips[token];
    if (!clip) throw new Error(`Missing pickup voice clip: ${token}`);
    const scheduled = { ...clip, when: next };
    next += clip.duration + (token === "chime" ? 0.3 : token === "prefix" ? 0.28 : token === "suffix" ? 0.7 : 0.12);
    return scheduled;
  });
}
