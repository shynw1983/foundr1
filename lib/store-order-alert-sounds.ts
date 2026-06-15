import type { StoreOrderAlertSound } from "./module-setting-defaults";

type AlertTone = {
  at: number;
  frequency: number;
  duration: number;
  volume: number;
  type: OscillatorType;
};

const orderAlertTones: Record<StoreOrderAlertSound, AlertTone[]> = {
  foundr1_default: [
    { at: 0, frequency: 1046.5, duration: 0.14, volume: 0.34, type: "square" },
    { at: 0.18, frequency: 1568, duration: 0.16, volume: 0.42, type: "square" },
    { at: 0.48, frequency: 1046.5, duration: 0.14, volume: 0.34, type: "square" },
    { at: 0.66, frequency: 1568, duration: 0.2, volume: 0.44, type: "square" }
  ],
  kitchen_bell: [
    { at: 0, frequency: 1174.66, duration: 0.1, volume: 0.5, type: "triangle" },
    { at: 0.16, frequency: 1567.98, duration: 0.12, volume: 0.48, type: "triangle" },
    { at: 0.34, frequency: 1174.66, duration: 0.16, volume: 0.5, type: "triangle" }
  ],
  urgent_order: [
    { at: 0, frequency: 880, duration: 0.1, volume: 0.38, type: "square" },
    { at: 0.14, frequency: 1318.51, duration: 0.11, volume: 0.46, type: "square" },
    { at: 0.28, frequency: 1567.98, duration: 0.13, volume: 0.5, type: "square" },
    { at: 0.52, frequency: 659.25, duration: 0.18, volume: 0.38, type: "triangle" }
  ],
  soft_chime: [
    { at: 0, frequency: 659.25, duration: 0.22, volume: 0.26, type: "sine" },
    { at: 0.2, frequency: 880, duration: 0.26, volume: 0.3, type: "sine" },
    { at: 0.43, frequency: 1174.66, duration: 0.34, volume: 0.28, type: "sine" }
  ]
};

export function playStoreOrderAlertSound(context: AudioContext, sound: StoreOrderAlertSound) {
  for (const tone of orderAlertTones[sound] ?? orderAlertTones.kitchen_bell) {
    const startAt = context.currentTime + tone.at;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.value = tone.frequency;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(tone.volume, startAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.02);
  }
}
