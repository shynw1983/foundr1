package jp.foundr1.store.bridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.SharedPreferences;

public class BridgeProvisioningReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if ((context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) return;
        if (intent == null) return;

        SharedPreferences.Editor editor = BridgeConfig.prefs(context).edit();
        putIfPresent(editor, BridgeConfig.KEY_ENDPOINT, intent.getStringExtra("endpoint"));
        putIfPresent(editor, BridgeConfig.KEY_TOKEN, intent.getStringExtra("bridgeToken"));
        putIfPresent(editor, BridgeConfig.KEY_STORE_ID, intent.getStringExtra("storeId"));
        putIfPresent(editor, BridgeConfig.KEY_DEVICE_NAME, intent.getStringExtra("deviceName"));
        editor.commit();

        BridgeServiceStarter.ensureStarted(context, "provisioning");
    }

    private void putIfPresent(SharedPreferences.Editor editor, String key, String value) {
        if (value != null && !value.trim().isEmpty()) editor.putString(key, value.trim());
    }
}
