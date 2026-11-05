package jp.foundr1.store;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.*;
import org.json.*;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Store-only A&D private BLE profile. All GATT operations are serialized on this handler. */
public final class StoreAndBleScale {
    public interface Listener {
        void onLine(String line, String session, int epoch, long measurementElapsed);
        default void onLine(String line, String session, int epoch, long measurementElapsed, String tareToken) {
            onLine(line, session, epoch, measurementElapsed);
        }
    }
    public static final int PERMISSION_REQUEST = 7341;
    private static final UUID SERVICE = UUID.fromString("5699d362-0c53-11e7-93ae-92361f002671");
    private static final UUID RX = UUID.fromString("5699d646-0c53-11e7-93ae-92361f002671");
    private static final UUID TX = UUID.fromString("5699d772-0c53-11e7-93ae-92361f002671");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final long AUTH_MS = 15000, SCAN_MS = 150000;
    private static final long[] DISCOVERY_RETRY_MS = { 5000, 10000, 20000 };
    private static StoreAndBleScale instance;
    public static synchronized StoreAndBleScale get(Context context) {
        if (instance == null) instance = new StoreAndBleScale(context.getApplicationContext());
        return instance;
    }
    private final Context context;
    private final Handler handler;
    private final SharedPreferences prefs;
    private final LinkedHashMap<String,JSONObject> devices = new LinkedHashMap<>();
    private String identity = "", session = "", address = "", name = "", state = "disabled", message = "店舗で電子はかり連携を有効にしてください。";
    private int epoch = -1, discoveryFailures;
    private boolean enabled, scanning, manualDisconnect, waitingPermission;
    private int reconnectFailures=0;
    private long verifiedElapsed, scanUntil, stageUntil, nextConnect, nextQuery, lastReadingElapsed;
    private JSONObject lastReading;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic rx, tx;
    private BluetoothLeScanner scanner;
    // Android's callback thread snapshots this identity before posting to our
    // handler. A queued notification must never borrow a later request's context.
    private volatile AndBleQuery pending;
    private boolean pendingRetired;
    private TareContext tareContext = TareContext.LEGACY;
    private String preparedTareToken = "";
    private Listener listener;
    private WeakReference<Activity> permissionActivity = new WeakReference<>(null);

    private static final class TareContext {
        static final TareContext LEGACY = new TareContext("", "", 0, "");
        final String token, presetId, revision; final double grams;
        TareContext(String token, String presetId, double grams, String revision) {
            this.token = token; this.presetId = presetId; this.grams = grams; this.revision = revision;
        }
        static TareContext parse(JSONObject value) throws JSONException {
            if (value == null || value.length() == 0) return LEGACY;
            String token = value.optString("token", ""), preset = value.optString("presetId", ""), revision = value.optString("settingsRevision", "");
            if (!(value.opt("tareGrams") instanceof Number)) throw new IllegalArgumentException("Invalid tare weight");
            double grams = value.getDouble("tareGrams");
            if (!"preset".equals(value.optString("mode")) || !token.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                || !("small".equals(preset) || "large".equals(preset)) || revision.isEmpty() || revision.length() > 200
                || Double.isNaN(grams) || Double.isInfinite(grams) || grams <= 0 || grams > 3000
                || Math.abs(grams * 10 - Math.rint(grams * 10)) > 0.000001) throw new IllegalArgumentException("Invalid tare context");
            return new TareContext(token, preset, grams, revision);
        }
        boolean same(TareContext other) { return token.equals(other.token) && presetId.equals(other.presetId) && Double.compare(grams, other.grams) == 0 && revision.equals(other.revision); }
    }

    private StoreAndBleScale(Context context) {
        this.context = context;
        prefs = context.getSharedPreferences("store_and_ble_scale", Context.MODE_PRIVATE);
        HandlerThread thread = new HandlerThread("Foundr1AndScale"); thread.start(); handler = new Handler(thread.getLooper());
        IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(bondReceiver, filter, Context.RECEIVER_EXPORTED);
        else context.registerReceiver(bondReceiver, filter);
        handler.post(tick);
    }
    private JSONObject result(boolean ok, String error) {
        JSONObject value = new JSONObject();
        try { value.put("ok",ok).put("state",state); if (!ok) value.put("error",error); } catch(JSONException ignored) {}
        return value;
    }
    private JSONObject run(Callable<JSONObject> operation) {
        FutureTask<JSONObject> task = null;
        try {
            if (Looper.myLooper() == handler.getLooper()) return operation.call();
            task = new FutureTask<>(operation); handler.post(task); return task.get(3,TimeUnit.SECONDS);
        } catch(Exception error) {
            if (task != null) task.cancel(false);
            return result(false,"電子はかりの状態を確認できません。もう一度操作してください。");
        }
    }
    private static String hash(String value) {
        try { byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); StringBuilder out = new StringBuilder(); for(byte b:bytes) out.append(String.format(Locale.ROOT,"%02x",b & 255)); return out.toString(); }
        catch(Exception error) { throw new IllegalStateException(error); }
    }
    public void setListener(Listener value) { run(() -> { listener = value; return result(true,""); }); }
    public void setRelayContext(String tokenIdentity, boolean active, String nextSession, int nextEpoch) {
        setRelayContext(tokenIdentity, active, nextSession, nextEpoch, null);
    }
    public void setRelayContext(String tokenIdentity, boolean active, String nextSession, int nextEpoch, JSONObject nextTareContext) {
        run(() -> {
            TareContext nextTare;
            try { nextTare = TareContext.parse(nextTareContext); }
            catch (Exception error) {
                enabled = false; verifiedElapsed = 0; stopScan(); closeGatt(); session = ""; epoch = -1; tareContext = TareContext.LEGACY;
                state = "tare_context_error"; message = "容器重量の設定を確認できません。接続を確認してください。";
                return result(false, message);
            }
            String nextIdentity = tokenIdentity == null || tokenIdentity.isEmpty() ? "" : hash(tokenIdentity);
            String safeSession = nextSession == null ? "" : nextSession;
            boolean wasExpired = !authorized();
            if(!enabled&&active){reconnectFailures=0;nextConnect=0;}
            if (!identity.equals(nextIdentity)) {
                waitingPermission = false; permissionActivity.clear();
                stopScan(); closeGatt(); devices.clear(); identity = nextIdentity; manualDisconnect = false; discoveryFailures = 0;
                if (!identity.isEmpty() && identity.equals(prefs.getString("identity",""))) {
                    address = prefs.getString("address",""); name = prefs.getString("name","");
                } else { address = ""; name = ""; prefs.edit().clear().apply(); }
            }
            if (wasExpired) closeGatt();
            else if (!session.equals(safeSession) || epoch != nextEpoch || !tareContext.same(nextTare)) {
                // Q has no request ID. Keep its immutable old context until its complete response
                // is drained (or the original timeout forces a reconnect), and do not send a new
                // Q meanwhile. Merely dropping pending would attach a late old bowl to the new one.
                pendingRetired = pending != null;
                lastReading = null; lastReadingElapsed = 0; nextQuery = 0; preparedTareToken = "";
            }
            tareContext = nextTare;
            session = safeSession; epoch = nextEpoch; enabled = active && !identity.isEmpty(); verifiedElapsed = SystemClock.elapsedRealtime();
            if (!enabled) { waitingPermission = false; permissionActivity.clear(); stopScan(); closeGatt(); state = "disabled"; message = "店舗で電子はかり連携を有効にしてください。"; }
            else if (gatt == null && !manualDisconnect && !scanning) { state = address.isEmpty() ? "not_selected" : "disconnected"; message = address.isEmpty() ? "使う電子はかりを選んでください。" : "選択した電子はかりへの接続を待っています。"; }
            return result(true,"");
        });
    }
    private boolean authorized() { long age = SystemClock.elapsedRealtime() - verifiedElapsed; return enabled && !identity.isEmpty() && verifiedElapsed > 0 && age >= 0 && age < AUTH_MS; }
    private BluetoothAdapter adapter() { BluetoothManager manager = (BluetoothManager)context.getSystemService(Context.BLUETOOTH_SERVICE); return manager == null ? null : manager.getAdapter(); }
    private boolean permissions() {
        if (Build.VERSION.SDK_INT >= 31) return context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED && context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    private boolean bluetoothOn() { try { BluetoothAdapter a = adapter(); return permissions() && a != null && a.isEnabled(); } catch(SecurityException error) { return false; } }
    private boolean locationOn() {
        if (Build.VERSION.SDK_INT >= 31) return true;
        LocationManager manager = (LocationManager)context.getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= 28) return manager.isLocationEnabled();
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }
    public JSONObject snapshot() {
        return run(() -> {
            JSONObject out = new JSONObject(); JSONArray found = new JSONArray(); for(JSONObject device:devices.values()) found.put(device);
            return out.put("enabled",authorized()).put("state",state).put("message",message).put("scanning",scanning)
                .put("permissionsGranted",permissions()).put("bluetoothEnabled",bluetoothOn()).put("devices",found)
                .put("selected",address.isEmpty()?JSONObject.NULL:new JSONObject().put("name",name).put("address",address))
                .put("lastReading",lastReading == null ? JSONObject.NULL : lastReading)
                .put("lastReadingAgeMs",lastReadingElapsed == 0 ? -1 : SystemClock.elapsedRealtime()-lastReadingElapsed);
        });
    }
    public JSONObject scan(Activity activity) {
        return run(() -> {
            if (!authorized()) return result(false,"店舗との接続を確認してから、電子はかりを検索してください。");
            if (!permissions()) {
                permissionActivity = new WeakReference<>(activity); waitingPermission = true;
                state = "permission_required"; message = "近くの機器への接続を許可してください。";
                activity.runOnUiThread(() -> {
                    if (!activity.isFinishing()) activity.requestPermissions(Build.VERSION.SDK_INT >= 31
                        ? new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}
                        : new String[]{Manifest.permission.ACCESS_FINE_LOCATION},PERMISSION_REQUEST);
                });
                return result(true,"");
            }
            return beginScan();
        });
    }
    public static void onPermissionResult(Context context, int requestCode) {
        if (requestCode != PERMISSION_REQUEST) return;
        StoreAndBleScale scale = get(context);
        scale.run(() -> {
            if (!scale.waitingPermission) return scale.result(true,"");
            scale.waitingPermission = false; scale.permissionActivity.clear();
            if (!scale.permissions()) { scale.state = "permission_denied"; scale.message = "電子はかりを探すには、近くの機器への接続許可が必要です。"; return scale.result(false,scale.message); }
            return scale.beginScan();
        });
    }
    private JSONObject beginScan() {
        if (!authorized()) return result(false,"店舗との接続を確認してから、電子はかりを検索してください。");
        if (!bluetoothOn()) { state = "bluetooth_off"; message = "スマホの Bluetooth をオンにしてください。"; return result(false,message); }
        if (!locationOn()) { state = "location_off"; message = "電子はかりを探すには、スマホの位置情報をオンにしてください。"; return result(false,message); }
        stopScan(); closeGatt(); devices.clear();
        try {
            scanner = adapter().getBluetoothLeScanner();
            if (scanner == null) throw new IllegalStateException();
            // Official advertising contains a local name, not the private service UUID.
            scanner.startScan(null,new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),scanCallback);
            scanning = true; scanUntil = SystemClock.elapsedRealtime()+SCAN_MS; state = "scanning";
            message = "A&D の電子はかりを検索しています。見つからない場合は、はかりの電源を入れ直してください。";
            return result(true,"");
        } catch(Exception error) { state = "error"; message = "電子はかりの検索を開始できません。Bluetooth と接続許可を確認してください。"; return result(false,message); }
    }
    public JSONObject cancelScan() { return run(() -> { waitingPermission = false; stopScan(); state = gatt == null ? "disconnected" : state; message = "電子はかりの検索を終了しました。"; return result(true,""); }); }
    private void stopScan() { try { if (scanner != null && scanning) scanner.stopScan(scanCallback); } catch(Exception ignored) {} scanning = false; scanner = null; }
    public JSONObject select(String target) {
        return run(() -> {
            if (!authorized() || !permissions() || !bluetoothOn()) return result(false,"店舗との接続、Bluetooth、接続許可を確認してください。");
            JSONObject found = devices.get(target);
            if (found == null && !address.equals(target)) return result(false,"検索結果から使う電子はかりを選んでください。");
            stopScan(); closeGatt(); address = target; name = found == null ? name : found.optString("name","A&D_BT"); manualDisconnect = false; discoveryFailures = 0;
            prefs.edit().putString("identity",identity).putString("address",address).putString("name",name).apply();
            connect(); return result(true,"");
        });
    }
    public JSONObject disconnect() { return run(() -> { manualDisconnect = true; stopScan(); closeGatt(); state = "disconnected"; message = "電子はかりとの接続を停止しました。"; return result(true,""); }); }
    public JSONObject forget() { return run(() -> { manualDisconnect = true; stopScan(); closeGatt(); address = ""; name = ""; prefs.edit().clear().apply(); state = "not_selected"; message = "このスマホに保存した電子はかりの設定を削除しました。"; return result(true,""); }); }
    public void suspend() { run(() -> { enabled = false; verifiedElapsed = 0; waitingPermission = false; permissionActivity.clear(); stopScan(); closeGatt(); state = "disabled"; message = "電子はかりとの接続を停止しています。"; return result(true,""); }); }
    private void closeGatt() {
        BluetoothGatt previous = gatt; gatt = null; rx = null; tx = null; pending = null; pendingRetired = false; preparedTareToken = ""; lastReading = null; lastReadingElapsed = 0; stageUntil = 0;
        if (previous != null) { try { previous.disconnect(); } catch(Exception ignored) {} try { previous.close(); } catch(Exception ignored) {} }
    }
    private void fail(String code, String text, boolean retry) { closeGatt(); state = code; message = text; nextConnect = SystemClock.elapsedRealtime()+Math.min(60000,5000L<<Math.min(reconnectFailures++,4)); if (!retry) manualDisconnect = true; }
    private void retryDiscoveryFailure() {
        if (discoveryFailures >= DISCOVERY_RETRY_MS.length) {
            fail("reconnect_required","はかりの電源と Bluetooth を確認し、「選択中のはかりに再接続」を押してください。",false);
            return;
        }
        long delay = DISCOVERY_RETRY_MS[discoveryFailures++];
        fail("error","電子はかりの接続方法を確認できません。同じはかりへの再接続を待っています。",true);
        nextConnect = SystemClock.elapsedRealtime()+delay;
    }
    private void connect() {
        if (!authorized() || manualDisconnect || address.isEmpty() || !permissions() || !bluetoothOn()) return;
        try {
            state = "connecting"; message = "選択した電子はかりに接続しています。";
            gatt = adapter().getRemoteDevice(address).connectGatt(context,false,callback,BluetoothDevice.TRANSPORT_LE);
            stageUntil = SystemClock.elapsedRealtime()+25000;
            if (gatt == null) fail("error","電子はかりに接続できません。電源と距離を確認してください。",true);
        } catch(Exception error) { fail("error","電子はかりに接続できません。Bluetooth と接続許可を確認してください。",false); }
    }
    private void discover(BluetoothGatt current) {
        if (current != gatt || !authorized()) return;
        try { state = "discovering"; message = "電子はかりの接続方法を確認しています。"; stageUntil = SystemClock.elapsedRealtime()+10000; if (!current.discoverServices()) fail("error","電子はかりの接続方法を確認できません。",true); }
        catch(Exception error) { fail("error","電子はかりの接続許可を確認してください。",false); }
    }
    private final Runnable tick = new Runnable() { public void run() {
        try {
            long now = SystemClock.elapsedRealtime();
            if (enabled && !authorized()) { stopScan(); closeGatt(); state = "authorization_expired"; message = "店舗との通信を確認できません。接続が戻るまで計量を停止します。"; }
            if (scanning && now >= scanUntil) { stopScan(); state = gatt == null ? "disconnected" : state; message = "検索を終了しました。見つからない場合は、はかりの電源を入れ直して検索してください。"; }
            if (authorized()) {
                if (gatt != null && !permissions()) fail("permission_required","近くの機器への接続を許可してください。",false);
                else if (gatt != null && !bluetoothOn()) fail("bluetooth_off","スマホの Bluetooth をオンにしてください。",true);
                // Discovery may pause for two minutes. Retry the same device, but do not repeat failed pairing dialogs.
                else if (gatt != null && stageUntil > 0 && now >= stageUntil) fail("error","電子はかりの接続が完了しませんでした。Bluetooth のペア設定を確認してください。",!"bonding".equals(state));
                else if (gatt == null && !manualDisconnect && !scanning && now >= nextConnect) connect();
                if (pending != null && pending.expired(now)) fail("error",pending.clearsTare ? "電子はかりの風袋引きを解除できません。再接続します。" : "重量の応答を確認できません。選択したはかりに再接続します。",true);
                if (gatt != null && "connected".equals(state) && !session.isEmpty() && epoch >= 0 && pending == null && now >= nextQuery) query(now);
            }
        } catch(Exception error) { fail("error","電子はかりの状態を確認できません。もう一度接続してください。",false); }
        finally { handler.postDelayed(this,250); }
    }};
    private void query(long now) {
        if (!authorized() || gatt == null || tx == null) return;
        if (!tareContext.token.isEmpty() && !preparedTareToken.equals(tareContext.token)) {
            pending = AndBleQuery.clearTare(session, epoch, now, tareContext.token);
        } else {
            pending = new AndBleQuery(session, epoch, now, tareContext.token);
            // One CT response authorizes exactly one following Q, never later samples.
            preparedTareToken = "";
        }
        pendingRetired = false; nextQuery = now+1000;
        try {
            int type = (tx.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0 ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
            boolean accepted;
            if (Build.VERSION.SDK_INT >= 33) accepted = gatt.writeCharacteristic(tx,pending.command(),type) == BluetoothStatusCodes.SUCCESS;
            else { tx.setWriteType(type); tx.setValue(pending.command()); accepted = gatt.writeCharacteristic(tx); }
            if (!accepted) fail("error","電子はかりへの計量要求を送信できません。",true);
        } catch(Exception error) { fail("error","電子はかりへの計量要求を送信できません。",false); }
    }
    private void receive(BluetoothGatt current, UUID characteristic, byte[] bytes, long receivedElapsed, AndBleQuery receivedFor) {
        if (current != gatt || !RX.equals(characteristic) || !authorized() || receivedFor == null || pending != receivedFor) return;
        long now = SystemClock.elapsedRealtime();
        if (receivedElapsed > now || now-receivedElapsed > 2000 || pending.expired(now)) { fail("error","重量の応答が遅れたため、電子はかりに再接続します。",true); return; }
        try {
            String line = receivedFor.offer(bytes,receivedElapsed); if (line == null) return;
            AndBleQuery answered = receivedFor;
            boolean retired = pendingRetired || !answered.session.equals(session) || answered.epoch != epoch || !answered.tareToken.equals(tareContext.token);
            pending = null; pendingRetired = false;
            if (retired) return;
            if (answered.clearsTare) { preparedTareToken = answered.tareToken; nextQuery = 0; return; }
            AndScaleReading reading = AndScaleReading.parse(line);
            // The scale has no clock. Q send time is a conservative measurement-age lower bound.
            lastReading = new JSONObject().put("grams",reading.grams).put("stable",reading.stable).put("overload",reading.overload); lastReadingElapsed = answered.requestedElapsed;
            if (!answered.tareToken.isEmpty()) lastReading.put("grams",Math.round((reading.grams-tareContext.grams)*1000.0)/1000.0).put("grossGrams",reading.grams)
                .put("tareGrams",tareContext.grams).put("tarePresetId",tareContext.presetId).put("settingsRevision",tareContext.revision).put("mode","preset");
            if (listener != null) listener.onLine(line,answered.session,answered.epoch,answered.requestedElapsed,answered.tareToken);
        } catch(Exception error) { fail("protocol_error","電子はかりの応答を確認できません。再接続します。",true); }
    }
    private final ScanCallback scanCallback = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult result) { handler.post(() -> {
            if (!scanning || !authorized() || result.getScanRecord() == null) return;
            String foundName = result.getScanRecord().getDeviceName();
            if (foundName == null || !foundName.startsWith("A&D_BT")) return;
            try { String foundAddress = result.getDevice().getAddress(); if (devices.size() < 24 || devices.containsKey(foundAddress)) devices.put(foundAddress,new JSONObject().put("name",foundName).put("address",foundAddress).put("rssi",result.getRssi())); }
            catch(Exception ignored) {}
        }); }
        @Override public void onScanFailed(int code) { handler.post(() -> { stopScan(); state = "error"; message = "電子はかりを検索できません。しばらく待ってから再操作してください。"; }); }
    };
    private final BroadcastReceiver bondReceiver = new BroadcastReceiver() { @Override public void onReceive(Context c, Intent intent) {
        if (!BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(intent.getAction())) return;
        BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        int bond = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE,BluetoothDevice.ERROR);
        handler.post(() -> { try {
            if (gatt == null || device == null || !address.equals(device.getAddress()) || !"bonding".equals(state)) return;
            if (bond == BluetoothDevice.BOND_BONDED) discover(gatt);
            else if (bond == BluetoothDevice.BOND_NONE) fail("error","電子はかりのペア設定が完了しませんでした。スマホの Bluetooth 設定を確認してください。",false);
        } catch(SecurityException error) { fail("permission_required","近くの機器への接続を許可してください。",false); } });
    }};
    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt current, int status, int nextState) { handler.post(() -> {
            if (current != gatt) return;
            if (status != BluetoothGatt.GATT_SUCCESS || nextState == BluetoothProfile.STATE_DISCONNECTED) { fail("disconnected","電子はかりとの接続が切れました。同じはかりへの再接続を待っています。",!"bonding".equals(state)); return; }
            if (nextState == BluetoothProfile.STATE_CONNECTED) { try {
                if (!authorized()) { closeGatt(); return; }
                BluetoothDevice device = current.getDevice();
                if (device.getBondState() == BluetoothDevice.BOND_BONDED) discover(current);
                else { state = "bonding"; message = "スマホに表示される Bluetooth のペア設定を確認してください。"; stageUntil = SystemClock.elapsedRealtime()+35000; if (device.getBondState() != BluetoothDevice.BOND_BONDING && !device.createBond()) fail("error","Bluetooth のペア設定を開始できません。",false); }
            } catch(Exception error) { fail("error","Bluetooth の接続許可を確認してください。",false); } }
        }); }
        @Override public void onServicesDiscovered(BluetoothGatt current, int status) { handler.post(() -> {
            if (current != gatt || !authorized()) return;
            // A failed discovery callback does not prove that a known scale lacks this profile.
            // Retry the selected identity with a bounded backoff; explicit selection resets it.
            if (status != BluetoothGatt.GATT_SUCCESS) { retryDiscoveryFailure(); return; }
            BluetoothGattService service = current.getService(SERVICE);
            rx = service == null ? null : service.getCharacteristic(RX); tx = service == null ? null : service.getCharacteristic(TX);
            if (rx == null || tx == null) { fail("unsupported_properties","対応する A&D 電子はかりを確認できません。",false); return; }
            discoveryFailures = 0;
            int properties = rx.getProperties();
            boolean notify = (properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0;
            boolean indicate = (properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0;
            BluetoothGattDescriptor descriptor = rx.getDescriptor(CCCD);
            if ((!notify && !indicate) || descriptor == null || (tx.getProperties() & (BluetoothGattCharacteristic.PROPERTY_WRITE|BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) == 0) { fail("unsupported_properties","このはかりの通信方法は未確認です。最新重量を確認できないため、自動読み取りは使用できません。",false); return; }
            try {
                if (!current.setCharacteristicNotification(rx,true)) { fail("error","重量の受信を開始できません。",false); return; }
                state = "subscribing"; message = "電子はかりから重量を受け取る準備をしています。"; stageUntil = SystemClock.elapsedRealtime()+10000;
                byte[] value = notify ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
                boolean accepted;
                if (Build.VERSION.SDK_INT >= 33) accepted = current.writeDescriptor(descriptor,value) == BluetoothStatusCodes.SUCCESS;
                else { descriptor.setValue(value); accepted = current.writeDescriptor(descriptor); }
                if (!accepted) fail("error","重量の受信設定を保存できません。",true);
            } catch(Exception error) { fail("error","重量の受信設定を確認してください。",false); }
        }); }
        @Override public void onDescriptorWrite(BluetoothGatt current, BluetoothGattDescriptor descriptor, int status) { handler.post(() -> {
            if (current != gatt || !CCCD.equals(descriptor.getUuid()) || !"subscribing".equals(state)) return;
            if (status != BluetoothGatt.GATT_SUCCESS) { fail("error","重量の受信設定を完了できません。",true); return; }
            reconnectFailures = 0; state = "connected"; message = "電子はかりに接続しました。POS で計量を開始すると重量を読み取ります。"; stageUntil = 0; nextQuery = 0;
        }); }
        @Override public void onCharacteristicWrite(BluetoothGatt current, BluetoothGattCharacteristic characteristic, int status) { handler.post(() -> { if (current == gatt && TX.equals(characteristic.getUuid()) && status != BluetoothGatt.GATT_SUCCESS) fail("error","電子はかりへの計量要求を送信できません。",true); }); }
        @Override public void onCharacteristicChanged(BluetoothGatt current, BluetoothGattCharacteristic characteristic) {
            if (Build.VERSION.SDK_INT >= 33) return;
            AndBleQuery receivedFor = pending;
            if (receivedFor == null) return;
            long receivedElapsed = SystemClock.elapsedRealtime();
            byte[] bytes = characteristic.getValue(); if (bytes != null) { byte[] captured = bytes.clone(); UUID id = characteristic.getUuid(); handler.post(() -> receive(current,id,captured,receivedElapsed,receivedFor)); }
        }
        @Override public void onCharacteristicChanged(BluetoothGatt current, BluetoothGattCharacteristic characteristic, byte[] bytes) {
            AndBleQuery receivedFor = pending;
            if (receivedFor == null) return;
            long receivedElapsed = SystemClock.elapsedRealtime();
            byte[] captured = bytes.clone(); UUID id = characteristic.getUuid();
            handler.post(() -> receive(current,id,captured,receivedElapsed,receivedFor));
        }
    };
}
