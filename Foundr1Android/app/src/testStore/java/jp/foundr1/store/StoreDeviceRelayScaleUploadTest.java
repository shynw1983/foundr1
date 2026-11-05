package jp.foundr1.store;

import android.Manifest;
import android.app.Application;
import android.bluetooth.BluetoothGatt;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.os.Handler;
import android.os.SystemClock;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadow.api.Shadow;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.util.ReflectionHelpers.ClassParameter;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

/** Calls the actual scale worker with local agent responses; no service or network is started. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
@LooperMode(LooperMode.Mode.PAUSED)
public class StoreDeviceRelayScaleUploadTest {
    private static final String TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SESSION = "bowl-a";
    private Context context;
    private RecordingService service;
    private StoreAndBleScale scale;
    private BluetoothGatt gatt;
    private Handler handler;
    private Runnable tick;

    public static class RecordingService extends StoreDeviceRelayService {
        final List<String> calls = new ArrayList<>();
        final List<JSONObject> requests = new ArrayList<>();
        JSONObject tareContext;
        String heartbeatSession;
        Runnable duringReading;
        int readingFailure, heartbeatFailure;
        boolean registerClosed;
        @Override JSONObject call(String token, JSONObject data) throws Exception {
            String action = data.getString("action"); calls.add(action);
            requests.add(new JSONObject(data.toString()));
            int failure = "reading".equals(action) ? readingFailure : heartbeatFailure;
            if (failure != 0) {
                @SuppressWarnings("unchecked") Class<Exception> type = (Class<Exception>) Class.forName("jp.foundr1.store.StoreDeviceRelayService$ApiException");
                throw ReflectionHelpers.callConstructor(type, ClassParameter.from(int.class, failure));
            }
            if("reading".equals(action)){
                if(duringReading!=null)duringReading.run();
                return new JSONObject().put("ok",true);
            }
            assertEquals("heartbeat", action);assertEquals(1,data.getJSONObject("status").getInt("scaleTareVersion"));
            return new JSONObject().put("station", new JSONObject().put("store_id", "store-a").put("id", "register-a")
                .put("scale_session", tareContext==null?(heartbeatSession==null?JSONObject.NULL:heartbeatSession):SESSION).put("epoch", 3).put("scale_sequence", -1).put("scale_enabled", true)
                .put("scale_tare_context",tareContext==null?new JSONObject():tareContext)
                .put("scale_enabled",!registerClosed)
                .put("heartbeat_interval_ms",registerClosed?15000:3000).put("print_interval_ms",15000));
        }
    }

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        shadowOf((Application) context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        SystemClock.sleep(100);
        // get() attaches Android context without calling onCreate and its background schedulers.
        service = Robolectric.buildService(RecordingService.class).get();
        StoreDeviceRelayService.prefs(service).edit().clear().putString("token", TOKEN).putBoolean("wanted", true).commit();
        scale = ReflectionHelpers.callConstructor(StoreAndBleScale.class, ClassParameter.from(Context.class, context));
        handler = ReflectionHelpers.getField(scale, "handler"); tick = ReflectionHelpers.getField(scale, "tick");
        handler.removeCallbacks(tick);
        scale.setRelayContext(TOKEN, true, SESSION, 3);
        onDriver(() -> {
            handler.removeCallbacks(tick); gatt = Shadow.newInstanceOf(BluetoothGatt.class);
            ReflectionHelpers.setField(scale, "gatt", gatt); ReflectionHelpers.setField(scale, "state", "connected");
            return new JSONObject();
        });
        ReflectionHelpers.setField(service, "scale", scale);
        ReflectionHelpers.setField(service, "lastHeartbeat", SystemClock.elapsedRealtime());
        ReflectionHelpers.setField(service, "lastScaleState", "connected");
        try {
            Class<?> type = Class.forName("jp.foundr1.store.StoreDeviceRelayService$ScaleContext");
            Object value = ReflectionHelpers.callConstructor(type, ClassParameter.from(String.class, TOKEN), ClassParameter.from(String.class, SESSION), ClassParameter.from(int.class, 3));
            ReflectionHelpers.setField(service, "scaleContext", value);
        } catch (ClassNotFoundException error) { throw new AssertionError(error); }
        StoreDeviceRelayService.relayVerifiedElapsed = SystemClock.elapsedRealtime();
        StoreDeviceRelayService.relayStoreId = "store-a"; StoreDeviceRelayService.relayStationId = "register-a";
        queueReading();
    }

    private JSONObject onDriver(Callable<JSONObject> operation) {
        return ReflectionHelpers.callInstanceMethod(scale, "run", ClassParameter.from(Callable.class, operation));
    }
    private void queueReading() {
        queueReading("ST,+000300.0  g\r\n");
    }
    private void queueReading(String line) {
        ReflectionHelpers.callInstanceMethod(service, "onScaleLine", ClassParameter.from(String.class, line),
            ClassParameter.from(String.class, SESSION), ClassParameter.from(int.class, 3), ClassParameter.from(long.class, SystemClock.elapsedRealtime()));
    }
    private void step() { ReflectionHelpers.callInstanceMethod(service, "scaleTick"); }
    private Object queued() { return ReflectionHelpers.<AtomicReference<?>>getField(service, "latestReading").get(); }

    @After public void teardown() {
        if (service != null) {
            ReflectionHelpers.<ScheduledExecutorService>getField(service, "scaleWorker").shutdownNow();
            ReflectionHelpers.<ScheduledExecutorService>getField(service, "printWorker").shutdownNow();
        }
        if (scale != null) {
            onDriver(() -> { handler.removeCallbacks(tick); return new JSONObject(); }); scale.suspend();
            context.unregisterReceiver(ReflectionHelpers.<BroadcastReceiver>getField(scale, "bondReceiver")); handler.getLooper().quitSafely();
        }
        StoreDeviceRelayService.relayVerifiedElapsed = 0;
        StoreDeviceRelayService.relayStoreId = StoreDeviceRelayService.relayStationId = StoreDeviceRelayService.message = "";
    }

    @Test public void rejectedOldReadingPreservesGattAndRefreshesTheAuthenticatedSessionNextTick() {
        assertNotNull(queued()); service.readingFailure = 409; step();
        assertEquals(List.of("reading"), service.calls); assertNull(queued());
        assertEquals(0L, (long) ReflectionHelpers.<Long>getField(service, "lastHeartbeat"));
        assertSame(gatt, ReflectionHelpers.getField(scale, "gatt"));
        assertEquals("connected", scale.snapshot().optString("state"));
        assertEquals("store-a", StoreDeviceRelayService.relayStoreId);
        // Simulate another sample arriving before the server says adoption ended the session.
        queueReading(); step();
        assertEquals(List.of("reading", "heartbeat"), service.calls); assertNull(queued());
        assertEquals("", ReflectionHelpers.<String>getField(scale, "session"));
        assertSame(gatt, ReflectionHelpers.getField(scale, "gatt"));
        assertTrue(ReflectionHelpers.<Long>getField(service, "lastHeartbeat") > 0);
    }

    @Test public void unauthorizedAndOtherReadingFailuresStillFenceTheScale() {
        for (int status : new int[]{401, 403, 500}) {
            // Each status is an independent rejection scenario; retry cadence has its own regression.
            ReflectionHelpers.setField(service,"nextHeartbeatAttempt",0L);
            service.readingFailure = status; step();
            assertNull(ReflectionHelpers.getField(scale, "gatt"));
            assertEquals("disabled", scale.snapshot().optString("state"));
            assertFalse(scale.snapshot().optBoolean("enabled")); assertNull(queued());
            assertEquals("", StoreDeviceRelayService.relayStoreId);
            assertEquals(0, StoreDeviceRelayService.relayVerifiedElapsed);
            if (status != 500) {
                scale.setRelayContext(TOKEN, true, SESSION, 3);
                onDriver(() -> { ReflectionHelpers.setField(scale, "gatt", gatt); ReflectionHelpers.setField(scale, "state", "connected"); return new JSONObject(); });
                ReflectionHelpers.setField(service, "lastHeartbeat", SystemClock.elapsedRealtime());
                try {
                    Class<?> type = Class.forName("jp.foundr1.store.StoreDeviceRelayService$ScaleContext");
                    ReflectionHelpers.setField(service, "scaleContext", ReflectionHelpers.callConstructor(type,
                        ClassParameter.from(String.class, TOKEN), ClassParameter.from(String.class, SESSION), ClassParameter.from(int.class, 3)));
                } catch (ClassNotFoundException error) { throw new AssertionError(error); }
                queueReading();
            }
        }
    }

    @Test public void heartbeatConflictStillFencesRatherThanBeingTreatedAsARejectedSample() {
        ReflectionHelpers.setField(service, "lastHeartbeat", 0L); service.heartbeatFailure = 409; step();
        assertEquals(List.of("heartbeat"), service.calls);
        assertNull(ReflectionHelpers.getField(scale, "gatt")); assertNull(queued());
        assertEquals("disabled", scale.snapshot().optString("state"));
    }

    private void presetContext(String tareToken)throws Exception{
        service.tareContext=new JSONObject().put("mode","preset").put("token",tareToken).put("presetId","small").put("tareGrams",100).put("settingsRevision","revision-1");
        Class<?> type=Class.forName("jp.foundr1.store.StoreDeviceRelayService$ScaleContext");
        ReflectionHelpers.setField(service,"scaleContext",ReflectionHelpers.callConstructor(type,ClassParameter.from(String.class,TOKEN),ClassParameter.from(String.class,SESSION),ClassParameter.from(int.class,3),ClassParameter.from(String.class,tareToken)));
        scale.setRelayContext(TOKEN,true,SESSION,3,service.tareContext);
        ReflectionHelpers.<AtomicReference<?>>getField(service,"latestReading").set(null);
    }
    private void queueProof(String tareToken){
        ReflectionHelpers.callInstanceMethod(service,"onScaleLine",ClassParameter.from(String.class,"ST,+000300.0  g\r\n"),ClassParameter.from(String.class,SESSION),ClassParameter.from(int.class,3),ClassParameter.from(long.class,SystemClock.elapsedRealtime()),ClassParameter.from(String.class,tareToken));
    }
    @Test public void presetUploadRequiresExactProofAndPreservesTheRawGrossFrame()throws Exception{
        String proof="11111111-1111-4111-8111-111111111111";presetContext(proof);
        queueReading();assertNull(queued());queueProof("old-proof");assertNull(queued());queueProof(proof);assertNotNull(queued());step();
        assertEquals(List.of("reading"),service.calls);assertEquals(proof,service.requests.get(0).getString("tareToken"));
        assertEquals("ST,+000300.0  g\r\n",service.requests.get(0).getString("line"));
    }
    @Test public void legacyUploadDoesNotClaimTareProof(){
        step();assertEquals(List.of("reading"),service.calls);assertFalse(service.requests.get(0).has("tareToken"));
    }
    @Test public void heartbeatPublishesCapabilityAndDiscardsSamplesFromAReplacedTareContext()throws Exception{
        String a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
        presetContext(a);queueProof(a);service.tareContext.put("token",b);ReflectionHelpers.setField(service,"lastHeartbeat",0L);step();
        assertEquals(List.of("heartbeat"),service.calls);assertNull(queued());queueProof(a);assertNull(queued());queueProof(b);assertNotNull(queued());
    }

    @Test public void closedDutyStopsBleAndSuppressesHeartbeatsUntilIdleDeadline() {
        service.registerClosed=true;ReflectionHelpers.setField(service,"lastHeartbeat",0L);step();
        assertEquals("disabled",scale.snapshot().optString("state"));assertNull(queued());
        service.calls.clear();SystemClock.sleep(14999);step();assertTrue(service.calls.isEmpty());
        SystemClock.sleep(1);step();assertEquals(List.of("heartbeat"),service.calls);
        service.registerClosed=false;SystemClock.sleep(15000);step();
        assertTrue(scale.snapshot().optBoolean("enabled"));
    }

    @Test public void failedHeartbeatDoesNotRetryEveryWorkerTick() {
        service.heartbeatFailure=503;ReflectionHelpers.setField(service,"lastHeartbeat",0L);step();
        assertEquals(List.of("heartbeat"),service.calls);
        SystemClock.sleep(999);step();assertEquals(1,service.calls.size());
        SystemClock.sleep(1);step();assertEquals(2,service.calls.size());
        SystemClock.sleep(1999);step();assertEquals(2,service.calls.size());
        SystemClock.sleep(1);step();assertEquals(3,service.calls.size());
    }

    @Test public void idleScaleDiscoversANewBowlAfterOneSecondAndThenKeepsTheActiveCadence()throws Exception{
        Class<?> type=Class.forName("jp.foundr1.store.StoreDeviceRelayService$ScaleContext");
        ReflectionHelpers.setField(service,"scaleContext",ReflectionHelpers.callConstructor(type,
            ClassParameter.from(String.class,TOKEN),ClassParameter.from(String.class,""),ClassParameter.from(int.class,3)));
        scale.setRelayContext(TOKEN,true,"",3);ReflectionHelpers.<AtomicReference<?>>getField(service,"latestReading").set(null);
        service.heartbeatSession=SESSION;
        SystemClock.sleep(999);step();assertTrue(service.calls.isEmpty());
        SystemClock.sleep(1);step();assertEquals(List.of("heartbeat"),service.calls);
        assertEquals(SESSION,ReflectionHelpers.<String>getField(scale,"session"));
        SystemClock.sleep(2999);step();assertEquals(1,service.calls.size());
        SystemClock.sleep(1);step();assertEquals(List.of("heartbeat","heartbeat"),service.calls);
    }

    @Test public void slowUploadKeepsOnlyTheNewestPendingSampleAndNeverReplaysTheOlderOne(){
        service.duringReading=()->{
            service.duringReading=null;
            SystemClock.sleep(600);queueReading("US,+000301.0  g\r\n");
            SystemClock.sleep(600);queueReading("US,+000302.0  g\r\n");
        };
        step();assertEquals(List.of("reading"),service.calls);assertNotNull(queued());
        SystemClock.sleep(250);long beforeUpload=System.currentTimeMillis();step();long afterUpload=System.currentTimeMillis();
        assertEquals(List.of("reading","reading"),service.calls);
        assertEquals("US,+000302.0  g\r\n",service.requests.get(1).optString("line"));
        // The newest sample waited 250ms locally; HTTP arrival must not reset its age.
        long measuredAt=service.requests.get(1).optLong("measuredAt");
        assertTrue(measuredAt>=beforeUpload-250&&measuredAt<=afterUpload-250);
        assertNull(queued());step();assertEquals(2,service.calls.size());
    }

    @Test public void aDisabledScaleDoesNotUseTheFasterIdleDiscoveryCadence()throws Exception{
        Class<?> type=Class.forName("jp.foundr1.store.StoreDeviceRelayService$ScaleContext");
        ReflectionHelpers.setField(service,"scaleContext",ReflectionHelpers.callConstructor(type,
            ClassParameter.from(String.class,TOKEN),ClassParameter.from(String.class,""),ClassParameter.from(int.class,3)));
        scale.setRelayContext(TOKEN,false,"",3);
        ReflectionHelpers.setField(service,"lastScaleState","disabled");
        ReflectionHelpers.<AtomicReference<?>>getField(service,"latestReading").set(null);
        SystemClock.sleep(1000);step();assertTrue(service.calls.isEmpty());
        SystemClock.sleep(2000);step();assertEquals(List.of("heartbeat"),service.calls);
    }
}
