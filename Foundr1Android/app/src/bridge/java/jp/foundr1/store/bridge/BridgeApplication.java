package jp.foundr1.store.bridge;

import android.app.Application;

public class BridgeApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        BridgeHealthState.resetRuntimeConnections(this);
        BridgeHealthState.setPendingCount(this, BridgeUploadQueue.get(this).count());
        UberNotificationListenerService.requestConnection(this);
        BridgeCrashReporter.install(this);
        BridgeCrashReporter.uploadPending(this);
        BridgeCrashReporter.uploadLatestExitReason(this);
    }
}
