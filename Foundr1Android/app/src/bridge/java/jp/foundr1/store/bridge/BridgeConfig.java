package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.SharedPreferences;

import jp.foundr1.store.R;

final class BridgeConfig {
    static final String PLATFORM_UBER_EATS = "uber_eats";
    static final String PLATFORM_ROCKET_NOW = "rocket_now";
    static final String PLATFORM_DEMAE_CAN = "demae_can";
    static final String PLATFORM_ALL = "all";
    static final String PLATFORM_DUAL = "dual";
    static final String UBER_ORDERS_PACKAGE = "com.uber.restaurants";
    static final String ROCKET_NOW_PACKAGE = "com.cpone.merchant";
    static final String DEMAE_CAN_PACKAGE = "jp.co.yms.faxreplace.mainunit";
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
        if (PLATFORM_ROCKET_NOW.equals(platform))
            return configured.replace("/uber-eats/events", "/rocket-now/events");
        if (PLATFORM_DEMAE_CAN.equals(platform))
            return configured.replace("/uber-eats/events", "/demae-can/events");
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
        if (PLATFORM_UBER_EATS.equals(mode)
            || PLATFORM_ROCKET_NOW.equals(mode)
            || PLATFORM_DEMAE_CAN.equals(mode)) return mode;
        return normalizePrimaryPlatform(
            prefs(context).getString(KEY_PRIMARY_PLATFORM, PLATFORM_UBER_EATS)
        );
    }

    static boolean supportsPlatform(Context context, String platform) {
        String mode = platformMode(context);
        return PLATFORM_ALL.equals(mode) || mode.equals(platform);
    }

    static boolean supportsPackage(Context context, String packageName) {
        if (UBER_ORDERS_PACKAGE.equals(packageName)) {
            return supportsPlatform(context, PLATFORM_UBER_EATS);
        }
        if (ROCKET_NOW_PACKAGE.equals(packageName)) {
            return supportsPlatform(context, PLATFORM_ROCKET_NOW);
        }
        if (DEMAE_CAN_PACKAGE.equals(packageName)) {
            return supportsPlatform(context, PLATFORM_DEMAE_CAN);
        }
        return false;
    }

    static String packageForPlatform(String platform) {
        if (PLATFORM_ROCKET_NOW.equals(platform)) return ROCKET_NOW_PACKAGE;
        if (PLATFORM_DEMAE_CAN.equals(platform)) return DEMAE_CAN_PACKAGE;
        return UBER_ORDERS_PACKAGE;
    }

    static String platformSummary(Context context) {
        String mode = platformMode(context);
        if (PLATFORM_UBER_EATS.equals(mode)) return "Uber Eats 専用";
        if (PLATFORM_ROCKET_NOW.equals(mode)) return "Rocket Now 専用";
        if (PLATFORM_DEMAE_CAN.equals(mode)) return "出前館 専用";
        return "3サービス · 主画面 " + platformLabel(primaryPlatform(context));
    }

    static String normalizePlatformMode(String value) {
        if (PLATFORM_UBER_EATS.equals(value)
            || PLATFORM_ROCKET_NOW.equals(value)
            || PLATFORM_DEMAE_CAN.equals(value)) return value;
        if (PLATFORM_DUAL.equals(value) || PLATFORM_ALL.equals(value)) return PLATFORM_ALL;
        return PLATFORM_ALL;
    }

    static String normalizePrimaryPlatform(String value) {
        if (PLATFORM_ROCKET_NOW.equals(value) || PLATFORM_DEMAE_CAN.equals(value)) return value;
        return PLATFORM_UBER_EATS;
    }

    static String platformLabel(String platform) {
        if (PLATFORM_ROCKET_NOW.equals(platform)) return "Rocket Now";
        if (PLATFORM_DEMAE_CAN.equals(platform)) return "出前館";
        return "Uber Eats";
    }
}
