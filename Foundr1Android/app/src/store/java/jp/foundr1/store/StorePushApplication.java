package jp.foundr1.store;

public class StorePushApplication extends android.app.Application {
    @Override public void onCreate() {
        super.onCreate();
        StoreOrderPush.initialize(this);
    }
}
