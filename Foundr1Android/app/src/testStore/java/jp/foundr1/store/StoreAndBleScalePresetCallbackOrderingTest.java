package jp.foundr1.store;

import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.os.Handler;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ScheduledExecutorService;
import org.json.JSONObject;
import org.junit.Test;
import org.robolectric.Robolectric;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.util.ReflectionHelpers.ClassParameter;
import static org.junit.Assert.*;

/** Uses the store's preset-tare CT/Q path and the real upload worker, without hardware/network. */
public class StoreAndBleScalePresetCallbackOrderingTest extends StoreAndBleScaleTareTest {
    private static final String DEVICE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SESSION = "next-bowl";
    private static final String PROOF = "22222222-2222-4222-8222-222222222222";
    private static final UUID RX = UUID.fromString("5699d646-0c53-11e7-93ae-92361f002671");
    private static final String PREVIOUS = "ST,+000487.0  g\r\n", CURRENT = "ST,+000413.0  g\r\n";

    private StoreAndBleScale driver() { return ReflectionHelpers.getField(this, "scale"); }
    private Handler handler() { return ReflectionHelpers.getField(this, "handler"); }
    private JSONObject onDriver(Callable<JSONObject> operation) {
        return ReflectionHelpers.callInstanceMethod(driver(), "run", ClassParameter.from(Callable.class, operation));
    }
    private void tickOnce() {
        Runnable tick = ReflectionHelpers.getField(this, "tick");
        tick.run(); handler().removeCallbacks(tick);
    }
    private void notifyFrame(String frame, boolean modern) {
        BluetoothGattCallback callback = ReflectionHelpers.getField(driver(), "callback");
        BluetoothGatt gatt = ReflectionHelpers.getField(this, "gatt");
        BluetoothGattCharacteristic characteristic = new BluetoothGattCharacteristic(RX,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ);
        byte[] bytes = frame.getBytes(StandardCharsets.US_ASCII);
        if (modern) {
            // Invoke the actual byte[] override while keeping the offline API-28 test runtime.
            ReflectionHelpers.callInstanceMethod(callback, "onCharacteristicChanged",
                ClassParameter.from(BluetoothGatt.class, gatt),
                ClassParameter.from(BluetoothGattCharacteristic.class, characteristic),
                ClassParameter.from(byte[].class, bytes));
        } else {
            characteristic.setValue(bytes); callback.onCharacteristicChanged(gatt, characteristic);
        }
    }

    private void replay(boolean modern) throws Exception {
        JSONObject tare = new JSONObject().put("mode", "preset").put("token", PROOF)
            .put("presetId", "small").put("tareGrams", 204).put("settingsRevision", "revision-1");
        driver().setRelayContext(DEVICE, true, SESSION, 3, tare);
        onDriver(() -> {
            ReflectionHelpers.callInstanceMethod(this, "installGatt");
            tickOnce(); return new JSONObject();
        });
        notifyFrame("CT\r\n", modern); onDriver(JSONObject::new);
        assertNull(ReflectionHelpers.getField(driver(), "pending"));
        assertEquals(PROOF, ReflectionHelpers.getField(driver(), "preparedTareToken"));

        StoreDeviceRelayScaleUploadTest.RecordingService service = Robolectric
            .buildService(StoreDeviceRelayScaleUploadTest.RecordingService.class).get();
        StoreDeviceRelayService.prefs(service).edit().clear().putString("token", DEVICE).putBoolean("wanted", true).commit();
        ReflectionHelpers.setField(service, "scale", driver());
        ReflectionHelpers.setField(service, "lastHeartbeat", SystemClock.elapsedRealtime());
        ReflectionHelpers.setField(service, "lastScaleState", "connected");
        Class<?> type = Class.forName("jp.foundr1.store.StoreDeviceRelayService$ScaleContext");
        ReflectionHelpers.setField(service, "scaleContext", ReflectionHelpers.callConstructor(type,
            ClassParameter.from(String.class, DEVICE), ClassParameter.from(String.class, SESSION),
            ClassParameter.from(int.class, 3), ClassParameter.from(String.class, PROOF)));
        driver().setListener(new StoreAndBleScale.Listener() {
            @Override public void onLine(String line, String session, int epoch, long time) { fail("missing tare proof"); }
            @Override public void onLine(String line, String session, int epoch, long time, String proof) {
                ReflectionHelpers.callInstanceMethod(service, "onScaleLine",
                    ClassParameter.from(String.class, line), ClassParameter.from(String.class, session),
                    ClassParameter.from(int.class, epoch), ClassParameter.from(long.class, time),
                    ClassParameter.from(String.class, proof));
            }
        });
        try {
            for (int sample = 0; sample < 3; sample++) {
                if (sample > 0) {
                    // measuredAt uses the real wall clock, whereas Robolectric's
                    // elapsedRealtime clock advances independently.
                    Thread.sleep(1250);
                    SystemClock.sleep(1250);
                    onDriver(() -> { tickOnce(); return new JSONObject(); });
                    notifyFrame("CT\r\n", modern); onDriver(JSONObject::new);
                }
                onDriver(() -> {
                    // An injected old notification arrives in the CT-ack -> Q gap.
                    // The timer precedes its handler message in the same millisecond.
                    handler().post(this::tickOnce);
                    notifyFrame(PREVIOUS, modern);
                    return new JSONObject();
                });
                onDriver(JSONObject::new);
                // The actual current Q reply follows. The buggy driver already
                // consumed Q with 487g and drops this correct 413g reply while idle.
                notifyFrame(CURRENT, modern); onDriver(JSONObject::new);
                ReflectionHelpers.callInstanceMethod(service, "scaleTick");
            }
            assertEquals(3, service.requests.size());
            for (JSONObject upload : service.requests) {
                assertEquals("old 487g replaced the actual 413g Q responses: " + service.requests,
                    CURRENT, upload.getString("line"));
                assertEquals(SESSION, upload.getString("scaleSession"));
                assertEquals(PROOF, upload.getString("tareToken"));
            }
            assertTrue(service.requests.get(2).getLong("measuredAt") - service.requests.get(0).getLong("measuredAt") >= 2500);
        } finally {
            StoreDeviceRelayService.prefs(service).edit().clear().commit();
            ReflectionHelpers.<ScheduledExecutorService>getField(service, "scaleWorker").shutdownNow();
            ReflectionHelpers.<ScheduledExecutorService>getField(service, "printWorker").shutdownNow();
        }
    }

    @Test public void legacyCallbackMustNotUploadIdleOldWeightForANewPresetQuery() throws Exception { replay(false); }
    @Test public void byteArrayCallbackMustNotUploadIdleOldWeightForANewPresetQuery() throws Exception { replay(true); }
}
