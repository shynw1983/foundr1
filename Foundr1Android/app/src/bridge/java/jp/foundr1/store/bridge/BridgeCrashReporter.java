package jp.foundr1.store.bridge;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.List;

final class BridgeCrashReporter {
    private static final String TAG = "Foundr1BridgeCrash";
    private static final String PREFS = "foundr1_bridge_diagnostics";
    private static final String KEY_PENDING_CRASH = "pending_crash";
    private static final String KEY_LAST_EXIT_TIMESTAMP = "last_exit_timestamp";
    private static final int MAX_STACK_LENGTH = 12000;
    private static final long CAUGHT_REPORT_COOLDOWN_MS = 60000L;
    private static long lastCaughtReportAt = 0L;

    private BridgeCrashReporter() {}

    static void install(Context context) {
        Context appContext = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            record(appContext, "uncaught:" + thread.getName(), error);
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    static void reportCaught(Context context, String stage, Throwable error) {
        Log.e(TAG, "Recovered runtime failure at " + stage, error);
        long now = System.currentTimeMillis();
        synchronized (BridgeCrashReporter.class) {
            if (now - lastCaughtReportAt < CAUGHT_REPORT_COOLDOWN_MS) return;
            lastCaughtReportAt = now;
        }
        record(context.getApplicationContext(), "caught:" + stage, error);
        uploadPending(context);
    }

    static void uploadPending(Context context) {
        Context appContext = context.getApplicationContext();
        SharedPreferences preferences = prefs(appContext);
        String raw = preferences.getString(KEY_PENDING_CRASH, "");
        if (raw == null || raw.isEmpty()) return;
        try {
            JSONObject payload = new JSONObject(raw);
            BridgeUploader.upload(appContext, "bridge_crash", "", payload, success -> {
                if (success && raw.equals(preferences.getString(KEY_PENDING_CRASH, ""))) {
                    preferences.edit().remove(KEY_PENDING_CRASH).apply();
                }
            });
        } catch (Exception error) {
            preferences.edit().remove(KEY_PENDING_CRASH).apply();
        }
    }

    static void uploadLatestExitReason(Context context) {
        if (Build.VERSION.SDK_INT < 30) return;
        Context appContext = context.getApplicationContext();
        try {
            ActivityManager manager = (ActivityManager) appContext.getSystemService(Context.ACTIVITY_SERVICE);
            if (manager == null) return;
            List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(
                appContext.getPackageName(),
                0,
                1
            );
            if (exits.isEmpty()) return;
            ApplicationExitInfo exit = exits.get(0);
            long timestamp = exit.getTimestamp();
            SharedPreferences preferences = prefs(appContext);
            if (timestamp <= preferences.getLong(KEY_LAST_EXIT_TIMESTAMP, 0L)) return;
            JSONObject payload = new JSONObject();
            payload.put("timestamp", timestamp);
            payload.put("reason", exit.getReason());
            payload.put("status", exit.getStatus());
            payload.put("importance", exit.getImportance());
            payload.put("description", exit.getDescription());
            BridgeUploader.upload(appContext, "bridge_exit", "", payload, success -> {
                if (success) preferences.edit().putLong(KEY_LAST_EXIT_TIMESTAMP, timestamp).apply();
            });
        } catch (Exception error) {
            Log.w(TAG, "Unable to read the previous process exit reason", error);
        }
    }

    private static void record(Context context, String stage, Throwable error) {
        try {
            StringWriter writer = new StringWriter();
            error.printStackTrace(new PrintWriter(writer));
            String stack = writer.toString();
            if (stack.length() > MAX_STACK_LENGTH) stack = stack.substring(0, MAX_STACK_LENGTH);
            JSONObject payload = new JSONObject();
            payload.put("capturedAt", System.currentTimeMillis());
            payload.put("stage", stage);
            payload.put("errorType", error.getClass().getName());
            payload.put("message", error.getMessage() == null ? "" : error.getMessage());
            payload.put("stack", stack);
            prefs(context).edit().putString(KEY_PENDING_CRASH, payload.toString()).commit();
        } catch (Exception ignored) {
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
