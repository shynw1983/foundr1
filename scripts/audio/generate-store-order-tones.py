"""Original Foundr1 alert tones. No Uber/Rocket audio is copied. Deterministic 16-bit PCM."""
import math, struct, wave
from pathlib import Path
RATE = 24000
DURATION = 4.0
ROOT = Path(__file__).resolve().parents[2]

def tone(kind):
    samples = []
    notes = [(0.0, 0.24, 784), (.32, .24, 1046.5), (.64, .4, 1318.5),
             (1.28, .24, 784), (1.60, .24, 1046.5), (1.92, .4, 1318.5),
             (2.56, .24, 1046.5), (2.88, .46, 1318.5)] if kind == 'urgent' else [
             (i * .24, .18, 880 if i % 2 == 0 else 1174.7) for i in range(14)]
    for i in range(int(RATE * DURATION)):
        t = i / RATE
        value = 0.0
        for start, duration, freq in notes:
            dt = t - start
            if 0 <= dt < duration:
                attack = min(1, dt / .007)
                release = min(1, (duration - dt) / .022)
                envelope = attack * release * (.7 + .3 * math.exp(-dt * 7))
                value += envelope * (math.sin(2*math.pi*freq*dt) + .25*math.sin(2*math.pi*freq*2*dt) + .12*math.sin(2*math.pi*freq*3*dt)) / 1.37
        samples.append(int(value * .82 * 32767))
    assert max(abs(v) for v in samples) < 32767
    return struct.pack('<' + 'h' * len(samples), *samples)

for kind in ('urgent', 'pulse'):
    data = tone(kind)
    for directory in (ROOT/'Foundr1Android/app/src/store/res/raw', ROOT/'public/audio'):
        directory.mkdir(parents=True, exist_ok=True)
        path = directory/f'store_order_{kind}.wav'
        with wave.open(str(path), 'wb') as output:
            output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            output.writeframes(data)
        print(path.relative_to(ROOT), len(data), 'bytes,', DURATION, 'seconds')
