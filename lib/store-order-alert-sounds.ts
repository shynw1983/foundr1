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
    { at: 0, frequency: 880, duration: 0.18, volume: 0.34, type: "triangle" },
    { at: 0, frequency: 1760, duration: 0.14, volume: 0.12, type: "sine" },
    { at: 0.2, frequency: 1174.66, duration: 0.22, volume: 0.38, type: "triangle" },
    { at: 0.2, frequency: 2349.32, duration: 0.16, volume: 0.1, type: "sine" },
    { at: 0.62, frequency: 880, duration: 0.16, volume: 0.3, type: "triangle" },
    { at: 0.8, frequency: 1174.66, duration: 0.24, volume: 0.4, type: "triangle" }
  ],
  kitchen_bell: [
    { at: 0, frequency: 987.77, duration: 0.13, volume: 0.42, type: "triangle" },
    { at: 0, frequency: 1975.53, duration: 0.09, volume: 0.14, type: "sine" },
    { at: 0.15, frequency: 1318.51, duration: 0.15, volume: 0.44, type: "triangle" },
    { at: 0.15, frequency: 2637.02, duration: 0.1, volume: 0.12, type: "sine" },
    { at: 0.34, frequency: 1760, duration: 0.18, volume: 0.46, type: "triangle" },
    { at: 0.34, frequency: 3520, duration: 0.12, volume: 0.1, type: "sine" },
    { at: 0.76, frequency: 1318.51, duration: 0.18, volume: 0.38, type: "triangle" }
  ],
  urgent_order: [
    { at: 0, frequency: 784, duration: 0.12, volume: 0.36, type: "triangle" },
    { at: 0.13, frequency: 1174.66, duration: 0.12, volume: 0.42, type: "triangle" },
    { at: 0.26, frequency: 1760, duration: 0.14, volume: 0.46, type: "triangle" },
    { at: 0.5, frequency: 784, duration: 0.12, volume: 0.36, type: "triangle" },
    { at: 0.63, frequency: 1174.66, duration: 0.12, volume: 0.42, type: "triangle" },
    { at: 0.76, frequency: 1760, duration: 0.18, volume: 0.48, type: "triangle" },
    { at: 0.76, frequency: 3520, duration: 0.12, volume: 0.12, type: "sine" }
  ],
  soft_chime: [
    { at: 0, frequency: 659.25, duration: 0.2, volume: 0.24, type: "triangle" },
    { at: 0.19, frequency: 987.77, duration: 0.24, volume: 0.28, type: "sine" },
    { at: 0.42, frequency: 1318.51, duration: 0.32, volume: 0.26, type: "sine" },
    { at: 0.42, frequency: 2637.02, duration: 0.18, volume: 0.08, type: "sine" }
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
    gain.gain.exponentialRampToValueAtTime(tone.volume, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.02);
  }
}
