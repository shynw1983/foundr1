package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.SharedPreferences;

import jp.foundr1.store.R;

final class BridgeConfig {
    static final String PLATFORM_UBER_EATS = "uber_eats";
    static final String PLATFORM_ROCKET_NOW = "rocket_now";
    static final String PLATFORM_DUAL = "dual";
    static final String UBER_ORDERS_PACKAGE = "com.uber.restaurants";
    static final String ROCKET_NOW_PACKAGE = "com.cpone.merchant";
    static final String PREFS = "foundr1_bridge";
    static final String KEY_ENDPOINT = "endpoint";
    static final String KEY_TOKEN = "token";
    static final String KEY_STORE_ID = "store_id";
    static final String KEY_DEVICE_NAME = "device_name";
    static final String KEY_PLATFORM_MODE = "platform_mode";
    static final String KEY_PRIMARY_PLATFORM = "primary_platform";

    private BridgeConfig() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String endpoint(Context context) {
        String value = prefs(context).getString(KEY_ENDPOINT, "");
        if (value != null && !value.trim().isEmpty()) return value.trim();
        return context.getString(R.string.bridge_default_endpoint);
    }

    static String endpoint(Context context, String platform) {
        String configured = endpoint(context);
        if ("rocket_now".equals(platform)) {
            return configured.replace("/uber-eats/events", "/rocket-now/events");
        }
        return configured;
    }

    static String token(Context context) {
        String value = prefs(context).getString(KEY_TOKEN, "");
        return value == null ? "" : value.trim();
    }

    static String storeId(Context context) {
        String value = prefs(context).getString(KEY_STORE_ID, "");
        return value == null ? "" : value.trim();
    }

    static String deviceName(Context context) {
        String value = prefs(context).getString(KEY_DEVICE_NAME, "");
        return value == null ? "" : value.trim();
    }

    static String platformMode(Context context) {
        return normalizePlatformMode(prefs(context).getString(KEY_PLATFORM_MODE, PLATFORM_DUAL));
    }

    static String primaryPlatform(Context context) {
        String mode = platformMode(context);
        if (PLATFORM_UBER_EATS.equals(mode) || PLATFORM_ROCKET_NOW.equals(mode)) return mode;
        return normalizePrimaryPlatform(
            prefs(context).getString(KEY_PRIMARY_PLATFORM, PLATFORM_UBER_EATS)
        );
    }

    static boolean supportsPlatform(Context context, String platform) {
        String mode = platformMode(context);
        return PLATFORM_DUAL.equals(mode) || mode.equals(platform);
    }

    static boolean supportsPackage(Context context, String packageName) {
        if (UBER_ORDERS_PACKAGE.equals(packageName)) {
            return supportsPlatform(context, PLATFORM_UBER_EATS);
        }
        if (ROCKET_NOW_PACKAGE.equals(packageName)) {
            return supportsPlatform(context, PLATFORM_ROCKET_NOW);
        }
        return false;
    }

    static String packageForPlatform(String platform) {
        return PLATFORM_ROCKET_NOW.equals(platform) ? ROCKET_NOW_PACKAGE : UBER_ORDERS_PACKAGE;
    }

    static String platformSummary(Context context) {
        String mode = platformMode(context);
        if (PLATFORM_UBER_EATS.equals(mode)) return "Uber Eats 専用";
        if (PLATFORM_ROCKET_NOW.equals(mode)) return "Rocket Now 専用";
        return "両方 · 主画面 "
            + (PLATFORM_ROCKET_NOW.equals(primaryPlatform(context)) ? "Rocket Now" : "Uber Eats");
    }

    static String normalizePlatformMode(String value) {
        if (PLATFORM_UBER_EATS.equals(value) || PLATFORM_ROCKET_NOW.equals(value)) return value;
        return PLATFORM_DUAL;
    }

    static String normalizePrimaryPlatform(String value) {
        return PLATFORM_ROCKET_NOW.equals(value) ? PLATFORM_ROCKET_NOW : PLATFORM_UBER_EATS;
    }
}
