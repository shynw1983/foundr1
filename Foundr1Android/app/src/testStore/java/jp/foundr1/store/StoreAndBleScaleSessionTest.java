package jp.foundr1.store;

import android.Manifest;
import android.app.Application;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.os.Handler;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadow.api.Shadow;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.util.ReflectionHelpers.ClassParameter;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

/** Exercises the real driver's session transitions with an in-memory GATT, never hardware. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class, shadows = StoreAndBleScaleSessionTest.RecordingGatt.class)
@LooperMode(LooperMode.Mode.PAUSED)
public class StoreAndBleScaleSessionTest {
    private static final String TOKEN = "relay-device-a";
    private static final UUID RX = UUID.fromString("5699d646-0c53-11e7-93ae-92361f002671");
    private static final UUID TX = UUID.fromString("5699d772-0c53-11e7-93ae-92361f002671");
    private static final String FRAME = "ST,+000300.0  g\r\n";
    private Context context;
    private StoreAndBleScale scale;
    private BluetoothGatt gatt;
    private Handler handler;
    private Runnable tick;
    private final List<String> delivered = new ArrayList<>();

    @Implements(BluetoothGatt.class)
    public static class RecordingGatt {
        static int writes, disconnects, closes;
        @Implementation protected boolean writeCharacteristic(BluetoothGattCharacteristic value) {
            assertArrayEquals(AndBleQuery.COMMAND, value.getValue());
            writes++; return true;
        }
        @Implementation protected void disconnect() { disconnects++; }
        @Implementation protected void close() { closes++; }
    }

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        shadowOf((Application) context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        BluetoothAdapter.getDefaultAdapter().enable();
        SystemClock.sleep(100);
        scale = ReflectionHelpers.callConstructor(StoreAndBleScale.class, ClassParameter.from(Context.class, context));
        handler = ReflectionHelpers.getField(scale, "handler");
        tick = ReflectionHelpers.getField(scale, "tick");
        handler.removeCallbacks(tick);
        scale.setRelayContext(TOKEN, true, "", 3);
        onDriver(() -> {
            handler.removeCallbacks(tick);
            gatt = Shadow.newInstanceOf(BluetoothGatt.class);
            ReflectionHelpers.setField(scale, "gatt", gatt);
            ReflectionHelpers.setField(scale, "state", "connected");
            ReflectionHelpers.setField(scale, "tx", new BluetoothGattCharacteristic(TX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE));
            return new JSONObject();
        });
        scale.setListener((line, session, epoch, time) -> delivered.add(session + ":" + epoch + ":" + line));
        RecordingGatt.writes = RecordingGatt.disconnects = RecordingGatt.closes = 0;
    }

    @After public void teardown() {
        if (scale == null) return;
        onDriver(() -> { handler.removeCallbacks(tick); return new JSONObject(); });
        scale.suspend();
        context.unregisterReceiver(ReflectionHelpers.<BroadcastReceiver>getField(scale, "bondReceiver"));
        handler.getLooper().quitSafely();
    }

    private JSONObject onDriver(Callable<JSONObject> operation) {
        return ReflectionHelpers.callInstanceMethod(scale, "run", ClassParameter.from(Callable.class, operation));
    }
    private void step() {
        onDriver(() -> { tick.run(); handler.removeCallbacks(tick); return new JSONObject(); });
    }
    private void receive(String text) {
        onDriver(() -> {
            ReflectionHelpers.callInstanceMethod(scale, "receive", ClassParameter.from(BluetoothGatt.class, gatt),
                ClassParameter.from(UUID.class, RX), ClassParameter.from(byte[].class, text.getBytes(StandardCharsets.US_ASCII)),
                ClassParameter.from(long.class, SystemClock.elapsedRealtime()),
                ClassParameter.from(AndBleQuery.class, ReflectionHelpers.getField(scale, "pending")));
            return new JSONObject();
        });
    }
    private AndBleQuery pending() { return ReflectionHelpers.getField(scale, "pending"); }
    private void assertConnected() {
        assertSame(gatt, ReflectionHelpers.getField(scale, "gatt"));
        assertEquals("connected", scale.snapshot().optString("state"));
        assertEquals(0, RecordingGatt.disconnects); assertEquals(0, RecordingGatt.closes);
    }

    @Test public void startingAndEndingIdleSessionsPreservesTheVerifiedGatt() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3);
        assertConnected(); step(); assertEquals(1, RecordingGatt.writes);
        receive(FRAME); assertEquals(1, delivered.size());
        assertFalse(scale.snapshot().isNull("lastReading"));
        scale.setRelayContext(TOKEN, true, "", 3);
        assertConnected(); assertTrue(scale.snapshot().isNull("lastReading"));
        step(); assertEquals(1, RecordingGatt.writes);
        scale.setRelayContext(TOKEN, true, "bowl-b", 4);
        assertConnected(); step(); assertEquals(2, RecordingGatt.writes);
        receive(FRAME); assertEquals(2, delivered.size());
        assertEquals("bowl-b:4:" + FRAME, delivered.get(1));
    }

    @Test public void fragmentedOldReplyDrainsBeforeTheNewSessionCanSendOrReceive() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); step();
        AndBleQuery old = pending(); receive("ST,+000");
        scale.setRelayContext(TOKEN, true, "bowl-b", 3);
        assertConnected(); step();
        assertSame(old, pending()); assertEquals(1, RecordingGatt.writes);
        receive("300.0  g\r"); step();
        assertSame(old, pending()); assertEquals(1, RecordingGatt.writes);
        receive("\n");
        assertNull(pending()); assertTrue(delivered.isEmpty()); assertTrue(scale.snapshot().isNull("lastReading"));
        step(); assertEquals(2, RecordingGatt.writes);
        assertEquals("bowl-b", pending().session);
        receive(FRAME); assertEquals(1, delivered.size());
        assertEquals("bowl-b:3:" + FRAME, delivered.get(0)); assertConnected();
    }

    @Test public void epochChangeAndReturnToSameSessionCannotReviveAnOldRequest() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); step();
        scale.setRelayContext(TOKEN, true, "bowl-a", 4);
        scale.setRelayContext(TOKEN, true, "bowl-a", 3);
        receive(FRAME);
        assertTrue(delivered.isEmpty()); assertTrue(scale.snapshot().isNull("lastReading"));
        step(); receive(FRAME);
        assertEquals(1, delivered.size()); assertConnected();
    }

    @Test public void endingARequestAndStartingAnotherWaitsForTheEntireOldFrame() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); step();
        scale.setRelayContext(TOKEN, true, "", 3);
        scale.setRelayContext(TOKEN, true, "bowl-b", 4);
        receive("Q\r\nACK\r\n"); step();
        assertEquals(1, RecordingGatt.writes); assertTrue(delivered.isEmpty());
        receive(FRAME); assertTrue(delivered.isEmpty());
        step(); receive(FRAME);
        assertEquals(2, RecordingGatt.writes); assertEquals(1, delivered.size()); assertConnected();
    }

    @Test public void anUnansweredRetiredQueryStillTimesOutAndReconnectsRatherThanGuessing() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); step();
        scale.setRelayContext(TOKEN, true, "bowl-b", 3);
        SystemClock.sleep(AndBleQuery.TIMEOUT_MS); step();
        assertEquals(1, RecordingGatt.writes); assertEquals(1, RecordingGatt.disconnects); assertEquals(1, RecordingGatt.closes);
        assertNull(pending()); assertNull(ReflectionHelpers.getField(scale, "gatt"));
        assertTrue(delivered.isEmpty());
    }

    @Test public void malformedRetiredReplyCannotReleaseANewRequestOnTheSameLink() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); step();
        scale.setRelayContext(TOKEN, true, "bowl-b", 3);
        receive("ST,+0012.345 mg\r\n");
        assertNull(ReflectionHelpers.getField(scale, "gatt")); assertTrue(delivered.isEmpty());
        assertEquals(1, RecordingGatt.disconnects); assertEquals(1, RecordingGatt.closes);
    }

    @Test public void changingIdentityStillClosesGattAndRejectsOldCallbacks() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); step();
        scale.setRelayContext("relay-device-b", true, "bowl-b", 4);
        receive(FRAME);
        assertNull(ReflectionHelpers.getField(scale, "gatt")); assertTrue(delivered.isEmpty());
        assertEquals(1, RecordingGatt.disconnects); assertEquals(1, RecordingGatt.closes);
    }

    @Test public void disablingStillClosesGattAndRejectsOldCallbacks() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); step();
        scale.setRelayContext(TOKEN, false, "bowl-a", 3); receive(FRAME);
        assertNull(ReflectionHelpers.getField(scale, "gatt")); assertTrue(delivered.isEmpty());
        assertEquals("disabled", scale.snapshot().optString("state"));
        assertEquals(1, RecordingGatt.disconnects); assertEquals(1, RecordingGatt.closes);
    }

    @Test public void unchangedHeartbeatDoesNotRetireAFragmentedCurrentResponse() {
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); step(); receive("ST,+000");
        scale.setRelayContext(TOKEN, true, "bowl-a", 3); receive("300.0  g\r\n");
        assertEquals(1, delivered.size()); assertEquals("bowl-a:3:" + FRAME, delivered.get(0));
        assertConnected();
    }

    @Test public void expiryEvenBeforeTheTimerRunsStillClosesTheOldGatt() {
        SystemClock.sleep(15000);
        scale.setRelayContext(TOKEN, true, "bowl-a", 3);
        assertNull(ReflectionHelpers.getField(scale, "gatt"));
        assertEquals(1, RecordingGatt.disconnects); assertEquals(1, RecordingGatt.closes);
    }
}
