package jp.foundr1.store;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

/** Persist explicit relay intent independently from a saved device credential. */
public final class StoreDeviceRelayLifecycle {
    private static final Object LOCK = new Object();
    private static long pendingStartElapsed = -1;
    private static final long START_PENDING_MS = 15000;
    private StoreDeviceRelayLifecycle() {}
    private static boolean valid(String token) { return token != null && token.matches("[A-Za-z0-9_-]{43}"); }
    private static boolean requestedLocked(Context context) {
        // 0.2.25 saved no stop intent. A legacy token must never imply consent to auto-start.
        return StoreDeviceRelayService.prefs(context).getBoolean("wanted", false);
    }
    private static String savedLocked(Context context) {
        return StoreDeviceRelayService.prefs(context).getString("token", "");
    }
    public static boolean isRequested(Context context) { synchronized (LOCK) { return requestedLocked(context); } }
    public static boolean hasSavedConnection(Context context) { synchronized (LOCK) { return valid(savedLocked(context)); } }
    static String enabledToken(Context context) {
        synchronized (LOCK) { String token = savedLocked(context); return requestedLocked(context) && valid(token) ? token : ""; }
    }
    static boolean isCurrentEnabled(Context context, String token) {
        synchronized (LOCK) { return valid(token) && requestedLocked(context) && token.equals(savedLocked(context)); }
    }
    private static void startLocked(Context context) {
        pendingStartElapsed = SystemClock.elapsedRealtime();
        try { context.startForegroundService(new Intent(context, StoreDeviceRelayService.class)); }
        catch (RuntimeException error) { pendingStartElapsed = -1; throw error; }
    }
    public static void enableAndStart(Context context, String token) {
        if (!valid(token)) throw new IllegalArgumentException("端末認証を確認してください。");
        synchronized (LOCK) {
            if (!StoreDeviceRelayService.prefs(context).edit().putString("token", token).putBoolean("wanted", true).commit())
                throw new IllegalStateException("中継の設定を保存できません。");
            // Explicit starts retain ordering with a preceding stop/revocation. Android creates
            // only one instance; onStartCommand never adds another pair of workers.
            startLocked(context);
        }
    }
    public static void stop(Context context) {
        synchronized (LOCK) {
            if (!StoreDeviceRelayService.prefs(context).edit().putBoolean("wanted", false).commit())
                throw new IllegalStateException("中継の停止設定を保存できません。");
            pendingStartElapsed = -1;
            context.stopService(new Intent(context, StoreDeviceRelayService.class));
        }
    }
    static boolean revokeIfCurrent(Context context, String token) {
        synchronized (LOCK) {
            if (!valid(token) || !token.equals(savedLocked(context))) return false;
            if (!StoreDeviceRelayService.prefs(context).edit().putBoolean("wanted", false).commit())
                throw new IllegalStateException("中継認証の解除を保存できません。");
            pendingStartElapsed = -1;
            // Keep this command under the same lock as explicit enable/start. A late 401 from
            // an old token must neither disable a replacement token nor stop its new service.
            context.stopService(new Intent(context, StoreDeviceRelayService.class));
            return true;
        }
    }
    public static boolean resumeIfRequested(Context context) {
        synchronized (LOCK) {
            if (!requestedLocked(context) || !valid(savedLocked(context))) return false;
            long age = SystemClock.elapsedRealtime() - pendingStartElapsed;
            if (StoreDeviceRelayService.running || (pendingStartElapsed >= 0 && age >= 0 && age < START_PENDING_MS)) return true;
            try { startLocked(context); return true; }
            catch (RuntimeException error) {
                // Background starts can be restricted. Preserve intent for a later foreground
                // resume, without changing the credential or requesting a new pairing code.
                StoreDeviceRelayService.message = "中継を再開できません。Store App を開いて接続を確認してください。";
                return false;
            }
        }
    }
    static void serviceCreated() { synchronized (LOCK) { pendingStartElapsed = -1; } }
    static void serviceStopped() { synchronized (LOCK) { pendingStartElapsed = -1; } }
}
