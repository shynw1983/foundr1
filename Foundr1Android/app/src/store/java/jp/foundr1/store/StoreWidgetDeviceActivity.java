package jp.foundr1.store;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.Gravity;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;

/** A widget tap only reads. A named confirmation is the sole command path. */
public class StoreWidgetDeviceActivity extends Activity {
    static final String EXTRA_STORE = "device_store", EXTRA_KEY = "device_key", EXTRA_SLOT = "device_slot", EXTRA_SESSION = "device_session";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout content;
    private int widgetId, slot, readSequence;
    private String store, key, session, name;
    private boolean zh, busy, submitted;
    private JSONObject device;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        slot = getIntent().getIntExtra(EXTRA_SLOT, -1);
        store = getIntent().getStringExtra(EXTRA_STORE); key = getIntent().getStringExtra(EXTRA_KEY);
        session = InventoryApiClient.sessionKey(); zh = "zh".equals(InventoryWidgetProvider.language(this, widgetId));
        name = StoreWidgetDevicesData.slot(this, widgetId, slot).optString("name", zh ? "智能设备" : "スマート機器");
        FrameLayout backdrop = new FrameLayout(this);
        backdrop.setPadding(dp(18), dp(24), dp(18), dp(24));
        backdrop.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(dp(18), insets.getSystemWindowInsetTop() + dp(24), dp(18), insets.getSystemWindowInsetBottom() + dp(24)); return insets;
        });
        backdrop.setOnClickListener(v -> { if (!busy) finish(); });
        ScrollView scroll = new ScrollView(this);
        scroll.setOnClickListener(v -> {});
        GradientDrawable background = new GradientDrawable(); background.setCornerRadius(dp(22)); background.setColor(0xFFFAFCFA); scroll.setBackground(background);
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(20), dp(24), dp(20));
        scroll.addView(content);
        backdrop.addView(scroll, new FrameLayout.LayoutParams(Math.min(dp(420), getResources().getDisplayMetrics().widthPixels - dp(36)), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        setContentView(backdrop);
        if (!bound() || !session.equals(getIntent().getStringExtra(EXTRA_SESSION))) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
        load();
    }
    private boolean alive() { return !isFinishing() && !isDestroyed(); }
    private boolean bound() {
        return widgetId != AppWidgetManager.INVALID_APPWIDGET_ID && slot >= 0 && slot < 2 && store != null
            && !session.isEmpty() && session.equals(InventoryApiClient.sessionKey())
            && AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId) != null
            && store.equals(InventoryWidgetProvider.storeId(this, widgetId)) && StoreWidgetDevicePolicy.validKey(key)
            && !StoreWidgetScenePolicy.isScene(StoreWidgetDevicesData.slot(this, widgetId, slot))
            && key.equals(StoreWidgetDevicesData.slot(this, widgetId, slot).optString("key"));
    }
    void load() {
        if (busy) return;
        if (!bound()) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
        busy = true; device = null;
        int sequence = ++readSequence;
        header(); text(zh ? "读取当前状态…" : "現在の状態を確認中…", 16, false);
        long generation = StoreWidgetDevicesData.beginRead(session, store, key);
        new Thread(() -> {
            JSONObject read = null; Exception error = null;
            try {
                read = StoreWidgetDevicesData.find(InventoryApiClient.loadDevices(store, key, session), key);
                if (read == null) throw new InventoryApiClient.ApiException(404, "removed");
                StoreWidgetDevicesData.save(getApplicationContext(), session, store, key, generation, read);
            } catch (Exception problem) { error = problem; StoreWidgetDevicesData.failedRead(getApplicationContext(), session, store, key, generation); }
            JSONObject result = read; Exception failure = error;
            runOnUiThread(() -> {
                renderWidgets();
                if (!alive() || sequence != readSequence) return;
                busy = false;
                if (!bound()) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
                if (failure != null) failure(failure); else showDevice(result);
            });
        }, "foundr1-widget-device-read").start();
    }
    void showDevice(JSONObject current) {
        busy = false; submitted = false; device = current;
        if (current == null || !key.equals(current.optString("key"))) { failure(null); return; }
        name = current.optString("name", name); header(); text(StoreWidgetDevicePolicy.state(current, zh), 22, true);
        if (!bound()) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
        long elapsedNow = android.os.SystemClock.elapsedRealtime();
        boolean available = current.optBoolean("controlEnabled") && StoreWidgetDevicePolicy.freshForAction(current, elapsedNow);
        long cooldown = StoreWidgetDevicePolicy.cooldownRemaining(current, elapsedNow);
        if (cooldown > 0) text(zh ? "上一操作处理中，请稍后重新读取。" : "直前の操作を処理中です。少し待って再読込してください。", 14, false);
        else if (!available) text(zh ? "当前不能操作，请重新读取或在 Store 设备页确认。" : "現在は操作できません。再読込するかStoreの機器ページで確認してください。", 14, false);
        else {
            text(zh ? "确认设备与操作后再执行。" : "機器と操作内容を確認して実行してください。", 14, false);
            if (StoreWidgetDevicePolicy.hasAction(current, "press")) {
                text(zh ? "会按一次实体开关，实际灯光状态可能与显示不同。" : "物理スイッチを1回押します。実際の点灯状態と表示が異なる場合があります。", 14, false);
                action("press", null, true);
            }
            JSONObject sample = current.optJSONObject("sample");
            String power = sample == null ? "" : sample.optString("power");
            if (StoreWidgetDevicePolicy.hasAction(current, "turnOn")) action("turnOn", null, !"on".equals(power));
            if (StoreWidgetDevicePolicy.hasAction(current, "turnOff")) action("turnOff", null, "on".equals(power));
            if (StoreWidgetDevicePolicy.hasAction(current, "lock")) action("lock", null, sample == null || !"locked".equals(sample.optString("lockState")));
            if (StoreWidgetDevicePolicy.hasAction(current, "unlock")) action("unlock", null, sample != null && "locked".equals(sample.optString("lockState")));
            if (StoreWidgetDevicePolicy.hasAction(current, "setPosition")) { action("setPosition", 0, false); action("setPosition", 100, true); }
        }
        button(zh ? "重新读取" : "再読込", false, this::load);
        button(zh ? "取消" : "キャンセル", false, this::finish);
    }
    private void action(String action, Integer position, boolean primary) { button(StoreWidgetDevicePolicy.actionLabel(action, position, zh), primary, () -> execute(action, position)); }
    void execute(String action, Integer position) {
        if (busy || submitted) return;
        long elapsedNow = android.os.SystemClock.elapsedRealtime();
        if (!bound() || device == null || !device.optBoolean("controlEnabled") || !StoreWidgetDevicePolicy.hasAction(device, action)
            || !StoreWidgetDevicePolicy.freshForAction(device, elapsedNow)
            || StoreWidgetDevicePolicy.cooldownRemaining(device, elapsedNow) > 0) {
            failure(new InventoryApiClient.ApiException(409, "changed")); return;
        }
        submitted = true; busy = true;
        String requestId = java.util.UUID.randomUUID().toString();
        StoreWidgetDevicesData.invalidate(getApplicationContext(), session, store, key); renderWidgets();
        header(); text(zh ? "正在发送一次指令…" : "操作を送信中…", 16, false);
        new Thread(() -> {
            JSONObject response = null; Exception error = null;
            try { response = sendCommand(action, position, requestId); } catch (Exception problem) { error = problem; }
            JSONObject result = response; Exception failure = error;
            runOnUiThread(() -> {
                if (!alive()) return;
                busy = false;
                if (!bound()) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
                header();
                JSONObject command = result == null ? null : result.optJSONObject("command");
                String outcome = command == null ? "unknown" : command.optString("result");
                if ("accepted".equals(outcome)) text(zh ? "指令已发送，等待设备状态确认。" : "操作を送信しました。機器の状態を確認します。", 16, true);
                else if ("rejected".equals(outcome)) text(zh ? "操作未执行，请刷新状态后检查设备。" : "操作は実行されませんでした。再読込して機器を確認してください。", 16, true);
                else text(zh ? "结果尚未确认，请先读取状态，避免重复操作。" : "結果は未確認です。再操作の前に状態を確認してください。", 16, true);
                if (failure instanceof InventoryApiClient.ApiException) text(StoreWidgetDevicePolicy.error(failure, zh), 14, false);
                button(zh ? "读取状态" : "状態を確認", false, this::load);
                button(zh ? "关闭" : "閉じる", false, this::finish);
                // One bounded observation; never retry a physical command or poll in the background.
                if ("accepted".equals(outcome)) handler.postDelayed(() -> { if (alive() && !busy && submitted) load(); }, 10_000);
            });
        }, "foundr1-widget-device-command").start();
    }
    JSONObject sendCommand(String action, Integer position, String requestId) throws Exception { return InventoryApiClient.commandDevice(store, key, action, position, requestId, session); }
    private void failure(Exception error) {
        busy = false; device = null; header(); text(StoreWidgetDevicePolicy.error(error, zh), 16, true);
        if (bound()) button(zh ? "重新读取" : "再読込", false, this::load);
        button(zh ? "打开设备页" : "機器ページを開く", false, () -> {
            startActivity(new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("foundr1_href", "/store/devices?storeId=" + android.net.Uri.encode(store == null ? "" : store))); finish();
        });
        button(zh ? "关闭" : "閉じる", false, this::finish);
    }
    private void header() { content.removeAllViews(); text(name, 20, true); text(InventoryWidgetProvider.storeName(this, widgetId), 14, false); }
    private void renderWidgets() { for (int id : InventoryWidgetProvider.widgetIds(this)) InventoryWidgetProvider.renderWidget(this, id); }
    private void text(String value, int size, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(bold ? 0xFF173F35 : 0xFF526A5F);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setPadding(0, dp(5), 0, dp(7)); content.addView(view);
    }
    private void button(String label, boolean primary, Runnable click) {
        Button button = new Button(this); button.setText(label); button.setTextSize(16); button.setAllCaps(false); button.setTextColor(primary ? 0xFFFFFFFF : 0xFF173F35);
        GradientDrawable background = new GradientDrawable(); background.setCornerRadius(dp(10)); background.setColor(primary ? 0xFF173F35 : 0xFFEDF3E9);
        button.setBackground(background); button.setOnClickListener(v -> click.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)); params.topMargin = dp(8); content.addView(button, params);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy(); }
}
