package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.SharedPreferences;

import jp.foundr1.store.R;

final class BridgeConfig {
    static final String PREFS = "foundr1_bridge";
    static final String KEY_ENDPOINT = "endpoint";
    static final String KEY_TOKEN = "token";
    static final String KEY_STORE_ID = "store_id";
    static final String KEY_DEVICE_NAME = "device_name";

    private BridgeConfig() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String endpoint(Context context) {
        String value = prefs(context).getString(KEY_ENDPOINT, "");
        if (value != null && !value.trim().isEmpty()) return value.trim();
        return context.getString(R.string.bridge_default_endpoint);
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
}
