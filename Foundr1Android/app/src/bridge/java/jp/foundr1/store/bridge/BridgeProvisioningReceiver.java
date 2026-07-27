package jp.foundr1.store.bridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.SharedPreferences;
import android.os.Build;

public class BridgeProvisioningReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if ((context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) return;
        if (intent == null) return;

        SharedPreferences.Editor editor = BridgeConfig.prefs(context).edit();
        putIfPresent(editor, BridgeConfig.KEY_ENDPOINT, intent.getStringExtra("endpoint"));
        putIfPresent(editor, BridgeConfig.KEY_TOKEN, intent.getStringExtra("token"));
        putIfPresent(editor, BridgeConfig.KEY_STORE_ID, intent.getStringExtra("storeId"));
        putIfPresent(editor, BridgeConfig.KEY_DEVICE_NAME, intent.getStringExtra("deviceName"));
        editor.apply();

        Intent serviceIntent = new Intent(context, BridgeForegroundService.class);
        if (Build.VERSION.SDK_INT >= 26) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
    }

    private void putIfPresent(SharedPreferences.Editor editor, String key, String value) {
        if (value != null && !value.trim().isEmpty()) editor.putString(key, value.trim());
    }
}
