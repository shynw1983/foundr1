package jp.foundr1.store;

public class StorePushBootReceiver extends android.content.BroadcastReceiver {
    @Override public void onReceive(android.content.Context context, android.content.Intent intent) {
        if (!android.content.Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) && !android.content.Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        StoreOrderPush.markUnknown(context);
        StoreOrderPush.installGeofences(context);
        StoreOrderPush.refresh(context);
    }
}
