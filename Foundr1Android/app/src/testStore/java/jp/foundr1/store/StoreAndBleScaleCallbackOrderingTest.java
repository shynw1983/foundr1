package jp.foundr1.store;

import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.os.Handler;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.json.JSONObject;
import org.junit.Test;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.util.ReflectionHelpers.ClassParameter;
import static org.junit.Assert.*;

/** Replays actual notification callbacks queued behind the driver's next timer tick. */
public class StoreAndBleScaleCallbackOrderingTest extends StoreAndBleScaleSessionTest {
    private static final UUID RX = UUID.fromString("5699d646-0c53-11e7-93ae-92361f002671");
    private static final String PREVIOUS = "ST,+000487.0  g\r\n";
    private static final String CURRENT = "ST,+000413.0  g\r\n";

    private StoreAndBleScale driver() { return ReflectionHelpers.getField(this, "scale"); }
    private Handler handler() { return ReflectionHelpers.getField(this, "handler"); }
    private JSONObject onDriver(Callable<JSONObject> operation) {
        return ReflectionHelpers.callInstanceMethod(driver(), "run", ClassParameter.from(Callable.class, operation));
    }
    private void tickOnce() {
        Runnable tick = ReflectionHelpers.getField(this, "tick");
        tick.run(); handler().removeCallbacks(tick);
    }
    private void notifyWeight(String frame) {
        BluetoothGattCallback callback = ReflectionHelpers.getField(driver(), "callback");
        BluetoothGatt gatt = ReflectionHelpers.getField(this, "gatt");
        BluetoothGattCharacteristic characteristic = new BluetoothGattCharacteristic(RX,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ);
        characteristic.setValue(frame.getBytes(StandardCharsets.US_ASCII));
        callback.onCharacteristicChanged(gatt, characteristic);
    }
    private List<String> delivered() { return ReflectionHelpers.getField(this, "delivered"); }

    private void queueIdleNotificationBeforeNextQuery(boolean advanceClock) {
        driver().setRelayContext("relay-device-a", true, "next-bowl", 3);
        onDriver(() -> {
            assertNull(ReflectionHelpers.getField(driver(), "pending"));
            // The timer is already queued, but the notification reaches Android before
            // that timer issues Q. Both may have the same millisecond timestamp.
            handler().post(() -> { if (advanceClock) SystemClock.sleep(1); tickOnce(); });
            notifyWeight(PREVIOUS);
            return new JSONObject();
        });
        onDriver(JSONObject::new);
    }

    @Test public void idleNotificationMustNotAnswerANewQueryInTheSameMillisecond() {
        queueIdleNotificationBeforeNextQuery(false);
        assertTrue("an unsolicited old 487g notification was attributed to the next bowl", delivered().isEmpty());
        assertNotNull(ReflectionHelpers.getField(driver(), "pending"));
        notifyWeight(CURRENT); onDriver(JSONObject::new);
        assertEquals(List.of("next-bowl:3:" + CURRENT), delivered());
    }

    @Test public void earlierIdleNotificationIsAlreadyRejectedWhenTheClockAdvances() {
        queueIdleNotificationBeforeNextQuery(true);
        assertTrue(delivered().isEmpty());
        notifyWeight(CURRENT); onDriver(JSONObject::new);
        assertEquals(List.of("next-bowl:3:" + CURRENT), delivered());
    }

    @Test public void queuedOldRequestReplyIsDrainedBeforeTheNextBowlQuery() {
        driver().setRelayContext("relay-device-a", true, "previous-bowl", 3);
        onDriver(() -> { tickOnce(); return new JSONObject(); });
        onDriver(() -> {
            handler().post(() -> {
                driver().setRelayContext("relay-device-a", true, "next-bowl", 3);
                tickOnce();
            });
            notifyWeight(PREVIOUS);
            return new JSONObject();
        });
        onDriver(JSONObject::new);
        assertTrue(delivered().isEmpty());
        onDriver(() -> { tickOnce(); return new JSONObject(); });
        notifyWeight(CURRENT); onDriver(JSONObject::new);
        assertEquals(List.of("next-bowl:3:" + CURRENT), delivered());
    }

    @Test public void queuedDuplicateKeepsItsOriginalQueryAfterAnotherCallbackCompletesIt() {
        driver().setRelayContext("relay-device-a", true, "previous-bowl", 3);
        onDriver(() -> { tickOnce(); return new JSONObject(); });
        onDriver(() -> {
            notifyWeight(PREVIOUS);
            handler().post(() -> {
                driver().setRelayContext("relay-device-a", true, "next-bowl", 3);
                tickOnce();
            });
            // Both callbacks reached Android during the old request. The first
            // completes it before the timer starts Q for the next session.
            notifyWeight(PREVIOUS);
            return new JSONObject();
        });
        onDriver(JSONObject::new);
        assertEquals(List.of("previous-bowl:3:" + PREVIOUS), delivered());
        notifyWeight(CURRENT); onDriver(JSONObject::new);
        assertEquals(List.of("previous-bowl:3:" + PREVIOUS, "next-bowl:3:" + CURRENT), delivered());
    }
}
