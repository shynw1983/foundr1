package jp.foundr1.store;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

public class StoreGeofenceReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null) return;
        if (event.hasError()) {
            StoreOrderPush.markUnknown(context);
            StoreOrderPush.prefs(context).edit().putString("geoError", "GEOFENCE_" + event.getErrorCode()).apply();
            StoreOrderPush.enqueueSync(context);
            return;
        }
        if (event.getTriggeringGeofences() == null) return;
        for (Geofence fence : event.getTriggeringGeofences()) {
            String id = fence.getRequestId();
            if (id.endsWith(":outer") && event.getGeofenceTransition() == Geofence.GEOFENCE_TRANSITION_EXIT) {
                StoreOrderPush.setPresence(context, id.substring(0, id.length() - 6), "outside");
            } else if (id.endsWith(":inner") && event.getGeofenceTransition() == Geofence.GEOFENCE_TRANSITION_ENTER) {
                StoreOrderPush.setPresence(context, id.substring(0, id.length() - 6), "inside");
            }
        }
        StoreOrderPush.enqueueSync(context);
    }
}
