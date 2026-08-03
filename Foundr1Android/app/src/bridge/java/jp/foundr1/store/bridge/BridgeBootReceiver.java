package jp.foundr1.store.bridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BridgeBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        BridgeServiceStarter.ensureStarted(context, "boot_or_update");
    }
}
