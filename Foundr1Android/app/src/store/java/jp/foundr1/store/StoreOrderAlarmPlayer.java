package jp.foundr1.store;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

/** One looping player, independent of WebView lifetime and FCM repeat messages. */
final class StoreOrderAlarmPlayer {
    private final Context context;
    private final AudioManager audio;
    private final Vibrator vibrator;
    private MediaPlayer player;
    private AudioFocusRequest focus;
    private String tone = "";
    private boolean vibrationEnabled;
    private boolean focused;
    private long retryAfter;
    private String failedTone = "";
    private static final AudioAttributes ATTRIBUTES = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
    StoreOrderAlarmPlayer(Context context) {
        this.context = context;
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }
    void update(String nextTone, boolean vibrate) {
        if (player != null && tone.equals(nextTone) && vibrationEnabled == vibrate) return;
        if (player == null && failedTone.equals(nextTone) && android.os.SystemClock.elapsedRealtime() < retryAfter) return;
        stop(); tone = nextTone; vibrationEnabled = vibrate;
        try {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(ATTRIBUTES).setOnAudioFocusChangeListener(change -> {
                    if (player == null) return;
                    try {
                        if (change == AudioManager.AUDIOFOCUS_GAIN) { focused = true; player.start(); vibrate(); }
                        else if (change == AudioManager.AUDIOFOCUS_LOSS) { failedTone = tone; retryAfter = android.os.SystemClock.elapsedRealtime() + 15_000; stop(); }
                        else { focused = false; if (player.isPlaying()) player.pause(); if (vibrator != null) vibrator.cancel(); }
                    } catch (IllegalStateException ignored) { stop(); }
                }).build();
            focused = audio != null && audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            if (!focused) { failedTone = nextTone; retryAfter = android.os.SystemClock.elapsedRealtime() + 15_000; stop(); StoreOrderAlarmState.error(context, "AUDIO_FOCUS_UNAVAILABLE"); return; }
            int resource = "pulse".equals(tone) ? R.raw.store_order_pulse : R.raw.store_order_urgent;
            player = new MediaPlayer();
            player.setAudioAttributes(ATTRIBUTES);
            player.setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK);
            try (android.content.res.AssetFileDescriptor source = context.getResources().openRawResourceFd(resource)) {
                player.setDataSource(source.getFileDescriptor(), source.getStartOffset(), source.getLength());
            }
            player.setLooping(true);
            player.setOnErrorListener((media, what, extra) -> { failedTone = nextTone; retryAfter = android.os.SystemClock.elapsedRealtime() + 15_000; stop(); StoreOrderAlarmState.error(context, "AUDIO_PLAYBACK_FAILED"); return true; });
            player.prepare(); player.start(); vibrate();
            if (StoreOrderAlarmState.error(context).startsWith("AUDIO_")) StoreOrderAlarmState.error(context, "");
        } catch (Exception error) { failedTone = nextTone; retryAfter = android.os.SystemClock.elapsedRealtime() + 15_000; stop(); StoreOrderAlarmState.error(context, "AUDIO_PLAYBACK_FAILED"); }
    }
    private void vibrate() {
        if (focused && vibrationEnabled && vibrator != null && vibrator.hasVibrator()) {
            vibrator.vibrate(VibrationEffect.createWaveform(new long[] {0, 600, 200, 600, 200, 900, 800}, 0), ATTRIBUTES);
        }
    }
    void stop() {
        MediaPlayer old = player; player = null;
        if (old != null) { try { old.release(); } catch (RuntimeException ignored) {} }
        if (vibrator != null) vibrator.cancel();
        if (audio != null && focus != null) audio.abandonAudioFocusRequest(focus);
        focus = null; focused = false; tone = "";
    }
}
