package jp.foundr1.store;

import android.Manifest;
import android.app.Application;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.os.Handler;
import android.os.SystemClock;
import java.util.ArrayList;
import java.util.List;
import java.util.IdentityHashMap;
import java.util.Map;
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
import org.robolectric.annotation.RealObject;
import org.robolectric.shadow.api.Shadow;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.util.ReflectionHelpers.ClassParameter;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

/** Actual production callback/timer path against simulated Bluetooth, without real devices. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class, shadows = {
    StoreAndBleScaleReconnectTest.RecordingDevice.class,
    StoreAndBleScaleReconnectTest.RecordingGatt.class
})
@LooperMode(LooperMode.Mode.PAUSED)
public class StoreAndBleScaleReconnectTest {
    private static final String TOKEN = "relay-a", ADDRESS = "AA:BB:CC:DD:EE:FF";
    private static final UUID SERVICE = UUID.fromString("5699d362-0c53-11e7-93ae-92361f002671");
    private static final UUID RX = UUID.fromString("5699d646-0c53-11e7-93ae-92361f002671");
    private static final UUID TX = UUID.fromString("5699d772-0c53-11e7-93ae-92361f002671");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private Context context;
    private StoreAndBleScale scale;
    private BluetoothGatt oldGatt;
    private BluetoothGattCallback callback;
    private Handler handler;
    private Runnable tick;

    @Implements(BluetoothDevice.class)
    public static class RecordingDevice {
        @RealObject BluetoothDevice device;
        static final List<String> addresses = new ArrayList<>();
        static final List<BluetoothGatt> connections = new ArrayList<>();
        @Implementation protected BluetoothGatt connectGatt(Context context, boolean autoConnect, BluetoothGattCallback callback, int transport) {
            assertFalse(autoConnect); assertEquals(BluetoothDevice.TRANSPORT_LE, transport);
            addresses.add(device.getAddress());
            BluetoothGatt next = Shadow.newInstanceOf(BluetoothGatt.class); connections.add(next); return next;
        }
    }
    @Implements(BluetoothGatt.class)
    public static class RecordingGatt {
        static int closes;
        static final Map<BluetoothGatt,BluetoothGattService> services = new IdentityHashMap<>();
        @RealObject BluetoothGatt gatt;
        @Implementation protected void disconnect() {}
        @Implementation protected void close() { closes++; }
        @Implementation protected BluetoothGattService getService(UUID id) { return SERVICE.equals(id) ? services.get(gatt) : null; }
        @Implementation protected boolean setCharacteristicNotification(BluetoothGattCharacteristic value, boolean enabled) { return true; }
        @Implementation protected boolean writeDescriptor(BluetoothGattDescriptor value) { return true; }
    }

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        shadowOf((Application) context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        android.bluetooth.BluetoothAdapter.getDefaultAdapter().enable();
        SystemClock.sleep(100);
        scale = ReflectionHelpers.callConstructor(StoreAndBleScale.class, ClassParameter.from(Context.class, context));
        handler = ReflectionHelpers.getField(scale, "handler"); tick = ReflectionHelpers.getField(scale, "tick");
        handler.removeCallbacks(tick); scale.setRelayContext(TOKEN, true, "", 3);
        onDriver(() -> {
            handler.removeCallbacks(tick); oldGatt = Shadow.newInstanceOf(BluetoothGatt.class);
            ReflectionHelpers.setField(scale, "gatt", oldGatt); ReflectionHelpers.setField(scale, "state", "connected");
            ReflectionHelpers.setField(scale, "address", ADDRESS); ReflectionHelpers.setField(scale, "name", "A&D_BT_saved");
            return new JSONObject();
        });
        callback = ReflectionHelpers.getField(scale, "callback");
        RecordingDevice.addresses.clear(); RecordingDevice.connections.clear(); RecordingGatt.services.clear(); RecordingGatt.closes = 0;
    }
    private JSONObject onDriver(Callable<JSONObject> op) {
        return ReflectionHelpers.callInstanceMethod(scale, "run", ClassParameter.from(Callable.class, op));
    }
    private void barrier() { onDriver(JSONObject::new); }
    private void step() { onDriver(() -> { tick.run(); handler.removeCallbacks(tick); return new JSONObject(); }); }
    private BluetoothGatt currentGatt() { return ReflectionHelpers.getField(scale, "gatt"); }
    private void powerOff() { callback.onConnectionStateChange(oldGatt, BluetoothGatt.GATT_SUCCESS, BluetoothProfile.STATE_DISCONNECTED); barrier(); }
    private void elapseWithHeartbeats(long millis) {
        while (millis > 0) {
            long step = Math.min(millis, 1000); SystemClock.sleep(step); millis -= step;
            scale.setRelayContext(TOKEN, true, "", 3);
        }
    }
    private void discoveryFailure() {
        BluetoothGatt current = currentGatt(); assertNotNull(current);
        callback.onServicesDiscovered(current, 133); barrier();
    }
    private void exhaustDiscoveryRetries() {
        for (long delay : new long[] { 5000, 10000, 20000 }) {
            discoveryFailure(); elapseWithHeartbeats(delay); step();
        }
        discoveryFailure();
        assertEquals("reconnect_required", scale.snapshot().optString("state"));
        assertTrue(ReflectionHelpers.getField(scale, "manualDisconnect"));
    }
    private void discoverSuccessfully(BluetoothGatt current) {
        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        BluetoothGattCharacteristic rx = new BluetoothGattCharacteristic(RX, BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ);
        BluetoothGattDescriptor cccd = new BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_WRITE);
        rx.addDescriptor(cccd); service.addCharacteristic(rx);
        service.addCharacteristic(new BluetoothGattCharacteristic(TX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE));
        RecordingGatt.services.put(current, service);
        callback.onServicesDiscovered(current, BluetoothGatt.GATT_SUCCESS); barrier();
        assertEquals("subscribing", scale.snapshot().optString("state"));
        callback.onDescriptorWrite(current, cccd, BluetoothGatt.GATT_SUCCESS); barrier();
        assertEquals("connected", scale.snapshot().optString("state"));
    }
    @After public void teardown() {
        onDriver(() -> { handler.removeCallbacks(tick); return new JSONObject(); }); scale.suspend();
        context.unregisterReceiver(ReflectionHelpers.<BroadcastReceiver>getField(scale, "bondReceiver")); handler.getLooper().quitSafely();
    }

    @Test public void closedRegisterStopsReconnectAndReopeningKeepsTheSelectedScale() {
        powerOff();
        scale.setRelayContext(TOKEN,false,"",3);
        for(int n=0;n<12;n++){SystemClock.sleep(5000);scale.setRelayContext(TOKEN,false,"",3);step();}
        assertTrue(RecordingDevice.connections.isEmpty());assertNull(currentGatt());
        assertEquals(ADDRESS,ReflectionHelpers.<String>getField(scale,"address"));
        scale.setRelayContext(TOKEN,true,"",3);step();
        assertEquals(List.of(ADDRESS),RecordingDevice.addresses);
    }

    @Test public void repeatedPowerFailuresUseBoundedBackoffAndSuccessResetsIt() {
        powerOff();elapseWithHeartbeats(5000);step();
        BluetoothGatt first=currentGatt();callback.onConnectionStateChange(first,133,BluetoothProfile.STATE_DISCONNECTED);barrier();
        elapseWithHeartbeats(5000);step();assertEquals(1,RecordingDevice.connections.size());
        elapseWithHeartbeats(5000);step();assertEquals(2,RecordingDevice.connections.size());
        BluetoothGatt second=currentGatt();discoverSuccessfully(second);
        callback.onConnectionStateChange(second,133,BluetoothProfile.STATE_DISCONNECTED);barrier();
        elapseWithHeartbeats(5000);step();assertEquals(3,RecordingDevice.connections.size());
    }

    @Test public void normalPowerLossReconnectsTheSameSelectedAddressAfterFiveSeconds() {
        powerOff(); assertNull(currentGatt()); assertFalse(ReflectionHelpers.getField(scale, "manualDisconnect"));
        assertEquals("disconnected", scale.snapshot().optString("state"));
        SystemClock.sleep(4999); step(); assertTrue(RecordingDevice.connections.isEmpty());
        SystemClock.sleep(1); step();
        assertEquals(List.of(ADDRESS), RecordingDevice.addresses);
        assertSame(RecordingDevice.connections.get(0), currentGatt());
        assertEquals("connecting", scale.snapshot().optString("state")); assertEquals(1, RecordingGatt.closes);
    }

    @Test public void lateCallbacksFromTheClosedGattCannotBreakTheNewConnection() {
        powerOff(); SystemClock.sleep(5000); step(); BluetoothGatt next = currentGatt(); assertNotNull(next);
        callback.onConnectionStateChange(oldGatt, 133, BluetoothProfile.STATE_DISCONNECTED);
        callback.onServicesDiscovered(oldGatt, 133); barrier();
        assertSame(next, currentGatt()); assertEquals("connecting", scale.snapshot().optString("state"));
        assertEquals(1, RecordingGatt.closes); assertFalse(ReflectionHelpers.getField(scale, "manualDisconnect"));
        assertEquals(0, (int) ReflectionHelpers.<Integer>getField(scale, "discoveryFailures"));
    }

    @Test public void manualDisconnectNeverReconnectsOnTimerOrFreshHeartbeat() {
        scale.disconnect(); assertNull(currentGatt());
        SystemClock.sleep(5000); scale.setRelayContext(TOKEN, true, "bowl-b", 4); step();
        assertTrue(RecordingDevice.connections.isEmpty()); assertTrue(ReflectionHelpers.getField(scale, "manualDisconnect"));
        assertEquals("disconnected", scale.snapshot().optString("state"));
    }

    @Test public void transientDiscoveryFailureShouldRetryWithoutManualReselection() {
        discoveryFailure();
        assertEquals("error", scale.snapshot().optString("state"));
        assertFalse(ReflectionHelpers.getField(scale, "manualDisconnect"));
        elapseWithHeartbeats(5000); step();
        assertEquals("transient discovery failure must allow a new connection", List.of(ADDRESS), RecordingDevice.addresses);
    }

    @Test public void repeatedDiscoveryFailuresBackOffAndThenRequireExplicitReconnect() {
        int attempts = 0;
        for (long delay : new long[] { 5000, 10000, 20000 }) {
            discoveryFailure(); assertNull(currentGatt());
            assertFalse(ReflectionHelpers.getField(scale, "manualDisconnect"));
            elapseWithHeartbeats(delay - 1); step(); assertEquals(attempts, RecordingDevice.connections.size());
            elapseWithHeartbeats(1); step(); assertEquals(++attempts, RecordingDevice.connections.size());
            assertEquals(ADDRESS, RecordingDevice.addresses.get(attempts - 1));
        }
        discoveryFailure();
        assertEquals("reconnect_required", scale.snapshot().optString("state"));
        assertTrue(ReflectionHelpers.getField(scale, "manualDisconnect"));
        assertNull(currentGatt());
        elapseWithHeartbeats(60000); step(); assertEquals(attempts, RecordingDevice.connections.size());
    }

    @Test public void explicitReconnectUsesSavedAddressWithoutScanningAndRestartsRetryBudget() {
        exhaustDiscoveryRetries();
        assertEquals(0, scale.snapshot().optJSONArray("devices").length());
        assertTrue(scale.select(ADDRESS).optBoolean("ok"));
        assertNotNull(currentGatt()); assertFalse(ReflectionHelpers.getField(scale, "manualDisconnect"));
        assertEquals(0, (int) ReflectionHelpers.<Integer>getField(scale, "discoveryFailures"));
        int attempts = RecordingDevice.connections.size();
        discoveryFailure(); elapseWithHeartbeats(4999); step(); assertEquals(attempts, RecordingDevice.connections.size());
        elapseWithHeartbeats(1); step(); assertEquals(attempts + 1, RecordingDevice.connections.size());
    }

    @Test public void successfulDiscoveryResetsBudgetAndOrdinaryPowerLossStillWaitsFiveSeconds() {
        discoveryFailure(); elapseWithHeartbeats(5000); step();
        BluetoothGatt current = currentGatt(); discoverSuccessfully(current);
        assertEquals(0, (int) ReflectionHelpers.<Integer>getField(scale, "discoveryFailures"));
        callback.onConnectionStateChange(current, BluetoothGatt.GATT_SUCCESS, BluetoothProfile.STATE_DISCONNECTED); barrier();
        int attempts = RecordingDevice.connections.size();
        elapseWithHeartbeats(4999); step(); assertEquals(attempts, RecordingDevice.connections.size());
        elapseWithHeartbeats(1); step(); assertEquals(attempts + 1, RecordingDevice.connections.size());
        discoveryFailure(); elapseWithHeartbeats(5000); step();
        assertEquals(attempts + 2, RecordingDevice.connections.size());
    }

    @Test public void successfulDiscoveryWithoutRequiredProfileNeverRetriesAsTransient() {
        callback.onServicesDiscovered(oldGatt, BluetoothGatt.GATT_SUCCESS); barrier();
        assertEquals("unsupported_properties", scale.snapshot().optString("state"));
        assertTrue(ReflectionHelpers.getField(scale, "manualDisconnect"));
        elapseWithHeartbeats(30000); step(); assertTrue(RecordingDevice.connections.isEmpty());
    }

    @Test public void knownProfileWithUnsupportedNotificationPropertiesStillStops() {
        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(new BluetoothGattCharacteristic(RX, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ));
        service.addCharacteristic(new BluetoothGattCharacteristic(TX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE));
        RecordingGatt.services.put(oldGatt, service);
        callback.onServicesDiscovered(oldGatt, BluetoothGatt.GATT_SUCCESS); barrier();
        assertEquals("unsupported_properties", scale.snapshot().optString("state"));
        assertTrue(ReflectionHelpers.getField(scale, "manualDisconnect"));
        elapseWithHeartbeats(30000); step(); assertTrue(RecordingDevice.connections.isEmpty());
    }

    @Test public void permissionLossStillRequiresExplicitReconnectAfterPermissionIsRestored() {
        shadowOf((Application) context).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION); step();
        assertEquals("permission_required", scale.snapshot().optString("state"));
        assertTrue(ReflectionHelpers.getField(scale, "manualDisconnect"));
        shadowOf((Application) context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        elapseWithHeartbeats(5000); step(); assertTrue(RecordingDevice.connections.isEmpty());
        assertTrue(scale.select(ADDRESS).optBoolean("ok")); assertNotNull(currentGatt());
    }
}
