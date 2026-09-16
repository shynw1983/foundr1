package jp.foundr1.store;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONObject;

public class StorePushMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        StoreOrderPush.prefs(this).edit().putString("fcmToken", token).apply();
        StoreOrderPush.enqueueSync(this);
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        StoreOrderPush.display(this, new JSONObject(message.getData()));
    }
}
