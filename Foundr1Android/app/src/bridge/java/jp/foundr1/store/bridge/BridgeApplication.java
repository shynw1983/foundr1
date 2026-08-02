package jp.foundr1.store.bridge;

import android.app.Application;

public class BridgeApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        BridgeCrashReporter.install(this);
        BridgeCrashReporter.uploadPending(this);
        BridgeCrashReporter.uploadLatestExitReason(this);
    }
}
