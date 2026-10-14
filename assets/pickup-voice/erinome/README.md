# Erinome source recording

All active pickup clips come from this one recording. The cue sheet validates its SHA256 and exact segment boundaries. Do not replace individual clips with separately generated speech. Settings reuse the user-selected G persona; exact timbre across separate generation runs is not guaranteed. The source recording and prompts contain only synthetic pickup codes and fixed public announcements.

## Approved announcement chime (2026-10-15)

`chime-C-louder.wav` is the original Foundr1 soft single-tone C audition, raised by 7.3 dB and approved together with the Erinome P-1204 preview. The shipped sprite appends its resampled PCM after the unchanged 39 voice segments. Playback uses the 1.3-second chime followed by a 0.3-second gap, once at the start of a queued announcement batch; enable confirmation is spoken without a chime. Voice test starts a new batch. The chime and voice use the same decoded, cached Web Audio buffer and cancellation path. No speech generation or external API is required.
