package jp.foundr1.store;

import android.Manifest;
import android.app.Application;
import android.bluetooth.*;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.os.Handler;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Callable;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;
import org.robolectric.shadow.api.Shadow;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.util.ReflectionHelpers.ClassParameter;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

/** Actual driver command ordering and context isolation. All Bluetooth is in memory. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,application=Application.class,shadows=StoreAndBleScaleTareTest.RecordingGatt.class)
@LooperMode(LooperMode.Mode.PAUSED)
public class StoreAndBleScaleTareTest {
    private static final String DEVICE="relay-device-a", A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
    private static final String FRAME="ST,+000300.0  g\r\n";
    private static final UUID RX=UUID.fromString("5699d646-0c53-11e7-93ae-92361f002671"), TX=UUID.fromString("5699d772-0c53-11e7-93ae-92361f002671");
    private Context context; private StoreAndBleScale scale; private BluetoothGatt gatt; private Handler handler; private Runnable tick;
    private final List<String> delivered=new ArrayList<>();
    @Implements(BluetoothGatt.class) public static class RecordingGatt {
        static final List<String> writes=new ArrayList<>(); static int closes;
        @Implementation protected boolean writeCharacteristic(BluetoothGattCharacteristic c){writes.add(new String(c.getValue(),StandardCharsets.US_ASCII));return true;}
        @Implementation protected void disconnect(){}
        @Implementation protected void close(){closes++;}
    }
    @Before public void setup(){
        context=RuntimeEnvironment.getApplication();shadowOf((Application)context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        BluetoothAdapter.getDefaultAdapter().enable();SystemClock.sleep(100);
        scale=ReflectionHelpers.callConstructor(StoreAndBleScale.class,ClassParameter.from(Context.class,context));
        handler=ReflectionHelpers.getField(scale,"handler");tick=ReflectionHelpers.getField(scale,"tick");handler.removeCallbacks(tick);
        scale.setRelayContext(DEVICE,true,"bowl-a",3);
        onDriver(()->{handler.removeCallbacks(tick);installGatt();return new JSONObject();});
        scale.setListener(new StoreAndBleScale.Listener(){
            @Override public void onLine(String line,String session,int epoch,long time){delivered.add(session+":"+epoch+":legacy:"+line);}
            @Override public void onLine(String line,String session,int epoch,long time,String proof){delivered.add(session+":"+epoch+":"+proof+":"+line);}
        });
        RecordingGatt.writes.clear();RecordingGatt.closes=0;
    }
    private void installGatt(){gatt=Shadow.newInstanceOf(BluetoothGatt.class);ReflectionHelpers.setField(scale,"gatt",gatt);ReflectionHelpers.setField(scale,"state","connected");
        ReflectionHelpers.setField(scale,"tx",new BluetoothGattCharacteristic(TX,BluetoothGattCharacteristic.PROPERTY_WRITE,BluetoothGattCharacteristic.PERMISSION_WRITE));}
    private JSONObject onDriver(Callable<JSONObject> op){return ReflectionHelpers.callInstanceMethod(scale,"run",ClassParameter.from(Callable.class,op));}
    private void step(){onDriver(()->{tick.run();handler.removeCallbacks(tick);return new JSONObject();});}
    private void receive(String value){receive(gatt,value);}
    private void receive(BluetoothGatt current,String value){onDriver(()->{ReflectionHelpers.callInstanceMethod(scale,"receive",ClassParameter.from(BluetoothGatt.class,current),ClassParameter.from(UUID.class,RX),ClassParameter.from(byte[].class,value.getBytes(StandardCharsets.US_ASCII)),ClassParameter.from(long.class,SystemClock.elapsedRealtime()),ClassParameter.from(AndBleQuery.class,pending()));return new JSONObject();});}
    private JSONObject preset(String token,double grams)throws Exception{return new JSONObject().put("mode","preset").put("token",token).put("presetId","small").put("tareGrams",grams).put("settingsRevision","revision-1");}
    private void use(String token)throws Exception{scale.setRelayContext(DEVICE,true,"bowl-a",3,preset(token,100));}
    private AndBleQuery pending(){return ReflectionHelpers.getField(scale,"pending");}
    @After public void teardown(){if(scale==null)return;onDriver(()->{handler.removeCallbacks(tick);return new JSONObject();});scale.suspend();context.unregisterReceiver(ReflectionHelpers.<BroadcastReceiver>getField(scale,"bondReceiver"));handler.getLooper().quitSafely();}

    @Test public void everyGrossSampleRequiresCtResponseThenANewQuery()throws Exception{
        use(A);step();assertEquals(List.of("CT\r\n"),RecordingGatt.writes);assertTrue(pending().clearsTare);
        // A successful local write is not the manufacturer's application response.
        BluetoothGattCallback cb=ReflectionHelpers.getField(scale,"callback");
        cb.onCharacteristicWrite(gatt,ReflectionHelpers.getField(scale,"tx"),BluetoothGatt.GATT_SUCCESS);onDriver(JSONObject::new);step();
        assertEquals(1,RecordingGatt.writes.size());assertTrue(delivered.isEmpty());
        receive("C");step();assertEquals(1,RecordingGatt.writes.size());receive("T\r\n");step();
        assertEquals(List.of("CT\r\n","Q\r\n"),RecordingGatt.writes);assertEquals(A,pending().tareToken);
        receive(FRAME);assertEquals(List.of("bowl-a:3:"+A+":"+FRAME),delivered);
        JSONObject reading=scale.snapshot().getJSONObject("lastReading");assertEquals(200,reading.getDouble("grams"),0);assertEquals(300,reading.getDouble("grossGrams"),0);assertEquals(100,reading.getDouble("tareGrams"),0);
        SystemClock.sleep(1000);step();assertTrue(pending().clearsTare);receive("CT\r\n");step();receive(FRAME);
        assertEquals(List.of("CT\r\n","Q\r\n","CT\r\n","Q\r\n"),RecordingGatt.writes);assertEquals(2,delivered.size());
    }
    @Test public void legacyQueryAndFourArgumentListenerRemainCompatible(){
        scale.setListener((line,session,epoch,time)->delivered.add("legacy:"+line));step();receive(FRAME);
        assertEquals(List.of("Q\r\n"),RecordingGatt.writes);assertEquals(List.of("legacy:"+FRAME),delivered);
        assertFalse(scale.snapshot().optJSONObject("lastReading").has("grossGrams"));
    }
    @Test public void fragmentedLegacyQueryDrainsBeforeEnteringPresetMode()throws Exception{
        step();receive("ST,+000");use(A);step();assertEquals(1,RecordingGatt.writes.size());
        receive("300.0  g\r\n");assertTrue(delivered.isEmpty());step();
        assertEquals(List.of("Q\r\n","CT\r\n"),RecordingGatt.writes);receive("CT\r\n");step();receive(FRAME);
        assertEquals(List.of("bowl-a:3:"+A+":"+FRAME),delivered);
    }
    @Test public void retiredCtAckCannotPrepareANewContext()throws Exception{
        use(A);step();receive("C");use(B);step();assertEquals(1,RecordingGatt.writes.size());receive("T\r\n");step();
        assertEquals(List.of("CT\r\n","CT\r\n"),RecordingGatt.writes);assertTrue(pending().clearsTare);assertEquals(B,pending().tareToken);
        receive("CT\r\n");step();receive(FRAME);assertEquals(List.of("bowl-a:3:"+B+":"+FRAME),delivered);
    }
    @Test public void preparedCtCannotSurviveContextChangeBeforeItsQuery()throws Exception{
        use(A);step();receive("CT\r\n");use(B);step();
        assertEquals(List.of("CT\r\n","CT\r\n"),RecordingGatt.writes);assertTrue(pending().clearsTare);assertTrue(delivered.isEmpty());
    }
    @Test public void retiredGrossReplyCannotCarryItsProofIntoTheNextEpoch()throws Exception{
        use(A);step();receive("CT\r\n");step();receive("ST,+000");
        scale.setRelayContext(DEVICE,true,"bowl-b",4,preset(B,150));receive("300.0  g\r\n");step();
        assertTrue(delivered.isEmpty());assertTrue(pending().clearsTare);receive("CT\r\n");step();receive(FRAME);
        assertEquals(List.of("bowl-b:4:"+B+":"+FRAME),delivered);assertEquals(150,scale.snapshot().getJSONObject("lastReading").getDouble("grams"),0);
    }
    @Test public void ctTimeoutReconnectsAndOldGattAckDoesNotReleaseANewQuery()throws Exception{
        use(A);step();BluetoothGatt old=gatt;SystemClock.sleep(AndBleQuery.TIMEOUT_MS);step();
        assertNull(ReflectionHelpers.getField(scale,"gatt"));assertEquals(1,RecordingGatt.closes);assertTrue(delivered.isEmpty());
        onDriver(()->{installGatt();return new JSONObject();});step();assertTrue(pending().clearsTare);
        receive(old,"CT\r\n");step();assertTrue(pending().clearsTare);assertEquals(List.of("CT\r\n","CT\r\n"),RecordingGatt.writes);
        receive("CT\r\n");step();receive(FRAME);assertEquals(1,delivered.size());
    }
    @Test public void genericAckFailsClosedInsteadOfProvingGross()throws Exception{
        use(A);step();receive("ACK\r\n");assertNull(ReflectionHelpers.getField(scale,"gatt"));assertTrue(delivered.isEmpty());assertEquals("protocol_error",scale.snapshot().optString("state"));
    }
    @Test public void identicalHeartbeatPreservesCtAndGrossFragments()throws Exception{
        use(A);step();receive("C");use(A);receive("T\r\n");step();receive("ST,+000");use(A);receive("300.0  g\r\n");
        assertEquals(1,delivered.size());assertEquals(0,RecordingGatt.closes);
    }
    @Test public void disabledExpiredAndInvalidContextsCannotSendCtOrRetainProof()throws Exception{
        use(A);step();scale.setRelayContext(DEVICE,false,"bowl-a",3,preset(A,100));receive("CT\r\n");step();
        assertEquals(1,RecordingGatt.writes.size());assertTrue(delivered.isEmpty());
        onDriver(()->{installGatt();return new JSONObject();});use(A);step();SystemClock.sleep(15000);step();
        assertNull(ReflectionHelpers.getField(scale,"gatt"));
        scale.setRelayContext(DEVICE,true,"bowl-a",3,preset(A,0));step();assertFalse(scale.snapshot().optBoolean("enabled"));assertEquals("tare_context_error",scale.snapshot().optString("state"));
    }
}
