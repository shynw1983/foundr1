import {
  PICKUP_VOICE_MANIFEST_URL, pickupVoiceFallbackText, pickupVoiceSchedule, pickupVoiceTokens,
  validatePickupVoiceManifest, type PickupVoiceManifest
} from "./pickup-voice";

export type PickupVoiceStatus = "loading" | "recorded" | "fallback" | "blocked" | "unsupported";

export class PickupVoicePlayer {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private manifest: PickupVoiceManifest | null = null;
  private preparation: Promise<void> | null = null;
  private queue: string[][] = [];
  private generation = 0;
  private running = false;
  private sources = new Set<AudioBufferSourceNode>();
  private utterance: SpeechSynthesisUtterance | null = null;
  private disposed = false;
  private cancelPlayback: (() => void) | null = null;
  private activation: Promise<void> | null = null;

  constructor(private onStatus: (status: PickupVoiceStatus, credit?: string) => void) {}

  private getContext() {
    if (this.disposed) throw new Error("Voice player disposed");
    if (!this.context) this.context = new AudioContext();
    return this.context;
  }

  prepare() {
    if (this.preparation) return this.preparation;
    this.onStatus("loading");
    this.preparation = this.loadPack().catch(() => {
      if (!this.disposed) this.onStatus("speechSynthesis" in window ? "fallback" : "unsupported");
      // Retry on the next explicit voice enable/test action.
      this.preparation = null;
    });
    return this.preparation;
  }

  private async loadPack() {
    if (!("AudioContext" in window)) throw new Error("Web Audio unavailable");
    const cache = "caches" in window ? await caches.open("foundr1-pickup-voice-v1").catch(() => null) : null;
    // Refresh the small manifest online; retain the last complete pack for offline use.
    let response: Response | undefined;
    try {
      response = await fetch(PICKUP_VOICE_MANIFEST_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Voice pack unavailable");
    } catch {
      response = await cache?.match(PICKUP_VOICE_MANIFEST_URL);
    }
    if (!response?.ok) throw new Error("Voice pack unavailable");
    const manifestResponse = response.clone();
    const manifest = validatePickupVoiceManifest(await response.json());
    let audio = await cache?.match(manifest.audio);
    if (!audio?.ok) {
      audio = await fetch(manifest.audio, { signal: AbortSignal.timeout(15_000) });
      if (!audio.ok) throw new Error("Voice audio unavailable");
    }
    const audioResponse = audio.clone();
    const buffer = await this.getContext().decodeAudioData(await audio.arrayBuffer());
    if (Object.values(manifest.clips).some((clip) => clip.offset + clip.duration > buffer.duration + 0.001)) {
      throw new Error("Incomplete voice audio");
    }
    if (this.disposed) return;
    this.buffer = buffer;
    this.manifest = manifest;
    this.onStatus("recorded", manifest.credit);
    // Cache failure (private mode/storage quota) must not prevent playback.
    if (cache) {
      await cache.put(manifest.audio, audioResponse).then(() => cache.put(PICKUP_VOICE_MANIFEST_URL, manifestResponse)).catch(() => {});
    }
  }

  // Call synchronously from a click so the browser grants audio activation.
  activate() {
    try {
      if ("AudioContext" in window) {
        const resume = this.getContext().resume();
        this.activation = new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { if (!this.disposed) this.onStatus("blocked"); resolve(); }, 3000);
          resume.then(() => { clearTimeout(timeout); resolve(); }, () => {
            clearTimeout(timeout); if (!this.disposed) this.onStatus("blocked"); resolve();
          });
        });
      }
    } catch { /* Speech synthesis remains a fallback on older browsers. */ }
    void this.prepare();
  }

  announce(code: string) {
    try { this.enqueue(pickupVoiceTokens(code)); }
    catch { this.onStatus("fallback"); this.enqueue([`fallback:${code}`]); }
  }

  preview() { this.announce("P-1204"); }
  enabled() { this.enqueue(["enabled"]); }

  private enqueue(tokens: string[]) {
    if (this.disposed) return;
    this.queue.push(tokens);
    if (!this.running) void this.drain(this.generation);
  }

  private async drain(generation: number) {
    this.running = true;
    try {
      await this.prepare();
      // Browser resume completes asynchronously even when called from a real click.
      await this.activation;
      let announced = false;
      while (generation === this.generation && this.queue.length) {
        const tokens = this.queue.shift()!;
        if (this.buffer && this.manifest && !tokens[0].startsWith("fallback:")) {
          // Once playback has started, never fallback mid-code and repeat its prefix.
          try {
            const withChime = !announced && tokens[0] === "prefix" && this.manifest.clips.chime;
            await this.playRecorded(withChime ? ["chime", ...tokens] : tokens, generation);
            if (tokens[0] === "prefix") announced = true;
          }
          catch { if (generation === this.generation) this.onStatus("blocked"); }
        } else {
          await this.speakFallback(tokens, generation);
        }
      }
    } finally {
      if (generation === this.generation) this.running = false;
    }
  }

  private async playRecorded(tokens: string[], generation: number) {
    const context = this.getContext();
    // Suspended audio needs a real user gesture; don't accumulate stale calls.
    if (context.state !== "running") throw new Error("Audio activation required");
    if (generation !== this.generation) return;
    const schedule = pickupVoiceSchedule(tokens, this.manifest!, context.currentTime + 0.04);
    await new Promise<void>((resolve, reject) => {
      let pause: ReturnType<typeof setTimeout> | undefined;
      const finish = () => { clearTimeout(pause); if (this.cancelPlayback === finish) this.cancelPlayback = null; resolve(); };
      this.cancelPlayback = finish;
      try {
        schedule.forEach((clip, index) => {
          const source = context.createBufferSource();
          source.buffer = this.buffer;
          source.connect(context.destination);
          this.sources.add(source);
          source.onended = () => {
            this.sources.delete(source);
            source.disconnect();
            if (generation !== this.generation) return;
            if (index === schedule.length - 1) pause = setTimeout(finish, 650);
          };
          source.start(clip.when, clip.offset, clip.duration);
        });
        this.onStatus("recorded", this.manifest?.credit);
      } catch (error) {
        for (const source of this.sources) { try { source.stop(); } catch {} }
        if (this.cancelPlayback === finish) this.cancelPlayback = null;
        reject(error);
      }
    });
  }

  private speakFallback(tokens: string[], generation: number) {
    if (!("speechSynthesis" in window)) { this.onStatus("unsupported"); return Promise.resolve(); }
    this.onStatus("fallback");
    const text = tokens[0] === "enabled" ? "音声案内を開始します。"
      : tokens[0].startsWith("fallback:") ? pickupVoiceFallbackText(tokens[0].slice(9))
      : pickupVoiceFallbackText(tokens.slice(1, -1).join(""));
    return new Promise<void>((resolve) => {
      if (generation !== this.generation) { resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ja-JP";
      utterance.rate = 0.92;
      this.utterance = utterance;
      const timeout = setTimeout(() => {
        if (this.utterance === utterance) {
          window.speechSynthesis.cancel(); this.onStatus("blocked"); this.utterance = null;
        }
        resolve();
      }, 30_000);
      const finish = () => {
        clearTimeout(timeout);
        if (this.utterance === utterance) this.utterance = null;
        if (this.cancelPlayback === finish) this.cancelPlayback = null;
        resolve();
      };
      this.cancelPlayback = finish;
      utterance.onend = finish;
      utterance.onerror = () => { if (generation === this.generation) this.onStatus("blocked"); finish(); };
      window.speechSynthesis.speak(utterance);
    });
  }

  stop() {
    this.generation++;
    this.queue = [];
    this.running = false;
    this.cancelPlayback?.();
    this.cancelPlayback = null;
    for (const source of this.sources) { try { source.stop(); } catch {} }
    this.sources.clear();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.utterance = null;
  }

  dispose() {
    this.stop(); this.disposed = true;
    void this.context?.close();
  }
}
