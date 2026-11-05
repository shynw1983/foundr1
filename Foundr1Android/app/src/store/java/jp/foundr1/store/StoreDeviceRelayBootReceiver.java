package jp.foundr1.store;

/** Best-effort restoration after ordinary boot/update; never invents a legacy enable intent. */
public final class StoreDeviceRelayBootReceiver extends android.content.BroadcastReceiver {
    @Override public void onReceive(android.content.Context context, android.content.Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (android.content.Intent.ACTION_BOOT_COMPLETED.equals(action)
            || android.content.Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))
            StoreDeviceRelayLifecycle.resumeIfRequested(context);
    }
}
