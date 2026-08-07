package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

final class BridgePlatformState {
    private static final String TAG = "Foundr1BridgePlatform";
    private static final String PREFS = "foundr1_bridge_platform_state";
    private static final String KEY_ACTIVE_PACKAGE = "active_package";
    private static final String KEY_ACTIVE_CHANGED_AT = "active_changed_at";
    private static final String KEY_GUARD_PAUSED_UNTIL = "guard_paused_until";
    private static final String KEY_LAST_PRIMARY_LAUNCH_AT = "last_primary_launch_at";
    private static final String KEY_RETURN_PRIMARY_AFTER = "return_primary_after";
    private static final long UNKNOWN_APP_GRACE_MS = 15_000L;
    private static final long SECONDARY_PLATFORM_GRACE_MS = 90_000L;
    private static final long PRIMARY_LAUNCH_COOLDOWN_MS = 60_000L;

    private BridgePlatformState() {}

    static void noteActivePackage(Context context, String packageName) {
        if (packageName == null || packageName.trim().isEmpty()) return;
        SharedPreferences preferences = preferences(context);
        String normalized = packageName.trim();
        if (normalized.equals(preferences.getString(KEY_ACTIVE_PACKAGE, ""))) return;
        preferences.edit()
            .putString(KEY_ACTIVE_PACKAGE, normalized)
            .putLong(KEY_ACTIVE_CHANGED_AT, System.currentTimeMillis())
            .apply();
    }

    static void pauseForegroundGuard(Context context, long durationMs) {
        preferences(context).edit()
            .putLong(
                KEY_GUARD_PAUSED_UNTIL,
                System.currentTimeMillis() + Math.max(0L, durationMs)
            )
            .apply();
    }

    static void requestPrimaryReturn(Context context) {
        if (!BridgeConfig.PLATFORM_DUAL.equals(BridgeConfig.platformMode(context))) return;
        preferences(context).edit()
            .putLong(KEY_RETURN_PRIMARY_AFTER, System.currentTimeMillis() + 3_000L)
            .apply();
    }

    static void runForegroundGuard(Context context) {
        long now = System.currentTimeMillis();
        SharedPreferences preferences = preferences(context);
        if (preferences.getLong(KEY_GUARD_PAUSED_UNTIL, 0L) > now) return;
        if (BridgeCommandState.current(context) != null || UberRecoveryState.isPending(context)) return;

        String primaryPackage = BridgeConfig.packageForPlatform(
            BridgeConfig.primaryPlatform(context)
        );
        if (context.getPackageManager().getLaunchIntentForPackage(primaryPackage) == null) return;

        String activePackage = preferences.getString(KEY_ACTIVE_PACKAGE, "");
        long activeChangedAt = preferences.getLong(KEY_ACTIVE_CHANGED_AT, 0L);
        if (activeChangedAt == 0L) {
            preferences.edit().putLong(KEY_ACTIVE_CHANGED_AT, now).apply();
            return;
        }
        if (primaryPackage.equals(activePackage)) {
            preferences.edit().remove(KEY_RETURN_PRIMARY_AFTER).apply();
            return;
        }

        long returnPrimaryAfter = preferences.getLong(KEY_RETURN_PRIMARY_AFTER, 0L);
        boolean explicitReturnDue = returnPrimaryAfter > 0L && now >= returnPrimaryAfter;
        boolean supportedSecondary = BridgeConfig.supportsPackage(context, activePackage);
        long grace = supportedSecondary ? SECONDARY_PLATFORM_GRACE_MS : UNKNOWN_APP_GRACE_MS;
        if (!explicitReturnDue && now - activeChangedAt < grace) return;

        long lastLaunchAt = preferences.getLong(KEY_LAST_PRIMARY_LAUNCH_AT, 0L);
        if (now - lastLaunchAt < PRIMARY_LAUNCH_COOLDOWN_MS) return;
        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(primaryPackage);
        if (launchIntent == null) return;
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            context.startActivity(launchIntent);
            preferences.edit()
                .putLong(KEY_LAST_PRIMARY_LAUNCH_AT, now)
                .remove(KEY_RETURN_PRIMARY_AFTER)
                .apply();
            Log.i(TAG, "Primary platform restored package=" + primaryPackage);
        } catch (Exception error) {
            Log.w(TAG, "Unable to restore primary platform package=" + primaryPackage, error);
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
