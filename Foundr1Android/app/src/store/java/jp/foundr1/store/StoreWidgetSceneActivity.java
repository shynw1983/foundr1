package jp.foundr1.store;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

/** The launcher opens a read-only confirmation. The existing server executes a confirmed scene. */
public class StoreWidgetSceneActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout content;
    private int widgetId, slot, sequence;
    private String store, key, session, name, requestId;
    private long loadedAt, pollStarted;
    private boolean zh, busy, submitted, resumed, runActive;
    private JSONObject scene;
    private JSONArray devices;
    private String revision;
    private CheckBox unlock;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        slot = getIntent().getIntExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, -1);
        store = getIntent().getStringExtra(StoreWidgetDeviceActivity.EXTRA_STORE);
        key = getIntent().getStringExtra(StoreWidgetDeviceActivity.EXTRA_KEY);
        session = InventoryApiClient.sessionKey(); zh = "zh".equals(InventoryWidgetProvider.language(this, widgetId));
        name = StoreWidgetScenePolicy.name(StoreWidgetDevicesData.slot(this, widgetId, slot).optString("name", zh ? "场景" : "シーン"), zh);
        if (saved != null && StoreWidgetScenePolicy.uuid(saved.getString("sceneRequest"))) {
            requestId = saved.getString("sceneRequest"); submitted = true; pollStarted = saved.getLong("pollStarted");
        }
        FrameLayout backdrop = new FrameLayout(this); backdrop.setPadding(dp(18), dp(24), dp(18), dp(24));
        backdrop.setOnApplyWindowInsetsListener((view, insets) -> { view.setPadding(dp(18), insets.getSystemWindowInsetTop() + dp(24), dp(18), insets.getSystemWindowInsetBottom() + dp(24)); return insets; });
        backdrop.setOnClickListener(view -> { if (!busy) finish(); });
        ScrollView scroll = new ScrollView(this); scroll.setOnClickListener(view -> {});
        GradientDrawable surface = new GradientDrawable(); surface.setColor(0xFFFAFCFA); surface.setCornerRadius(dp(22)); scroll.setBackground(surface);
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(dp(24), dp(20), dp(24), dp(20)); scroll.addView(content);
        backdrop.addView(scroll, new FrameLayout.LayoutParams(Math.min(dp(460), getResources().getDisplayMetrics().widthPixels - dp(36)), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        setContentView(backdrop);
        if (!bound() || !session.equals(getIntent().getStringExtra(StoreWidgetDeviceActivity.EXTRA_SESSION))) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
        load();
    }
    private boolean alive() { return !isFinishing() && !isDestroyed(); }
    private boolean bound() {
        JSONObject binding = StoreWidgetDevicesData.slot(this, widgetId, slot);
        return widgetId != AppWidgetManager.INVALID_APPWIDGET_ID && StoreWidgetDevicesData.validSlot(slot) && store != null
            && !session.isEmpty() && session.equals(InventoryApiClient.sessionKey())
            && AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId) != null
            && store.equals(InventoryWidgetProvider.storeId(this, widgetId)) && StoreWidgetScenePolicy.uuid(key)
            && StoreWidgetScenePolicy.isScene(binding) && key.equals(binding.optString("key"));
    }
    void load() {
        if (busy) return;
        handler.removeCallbacksAndMessages(null);
        if (!bound()) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
        busy = true; int read = ++sequence;
        header(); text(requestId == null ? zh ? "读取最新场景…" : "最新のシーンを読み込み中…" : zh ? "读取执行结果…" : "実行結果を確認中…", 15, false);
        new Thread(() -> {
            JSONObject result = null; Exception error = null;
            try { result = requestId == null ? readCatalog() : readRun(requestId); } catch (Exception problem) { error = problem; }
            JSONObject body = result; Exception failure = error;
            runOnUiThread(() -> {
                if (!alive() || read != sequence) return;
                busy = false;
                if (!bound()) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
                if (failure != null) { failure(failure); return; }
                if (requestId != null) showRun(body); else showCatalog(body);
            });
        }, "foundr1-widget-scene-read").start();
    }
    JSONObject readCatalog() throws Exception { return InventoryApiClient.loadScenes(store, session); }
    JSONObject readRun(String id) throws Exception { return InventoryApiClient.loadSceneRun(store, id, session); }
    JSONObject sendScene(String id, boolean allowUnlock) throws Exception { return InventoryApiClient.runScene(store, key, revision, id, allowUnlock, session); }
    void showCatalog(JSONObject body) {
        busy = false;
        if (!bound() || body == null || !store.equals(body.optString("storeId"))) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
        scene = StoreWidgetScenePolicy.find(body, key); devices = body.optJSONArray("devices"); revision = body.optString("revision");
        if (!StoreWidgetScenePolicy.validScene(scene) || devices == null || !revision.isEmpty() && !StoreWidgetScenePolicy.uuid(revision)) { failure(new InventoryApiClient.ApiException(404, "removed")); return; }
        name = StoreWidgetScenePolicy.name(scene.optString("name"), zh); loadedAt = android.os.SystemClock.elapsedRealtime(); header();
        JSONObject current = body.optJSONObject("latestRun");
        if (current != null && "running".equals(current.optString("status"))) {
            if (key.equals(current.optString("sceneId")) && StoreWidgetScenePolicy.uuid(current.optString("id"))) {
                requestId = current.optString("id"); submitted = true; pollStarted = android.os.SystemClock.elapsedRealtime(); showRun(current); return;
            }
            text(zh ? "本店的其他场景正在执行，请完成后重新读取。" : "この店舗で別のシーンを実行中です。完了後に再読込してください。", 15, true);
            button(zh ? "重新读取" : "再読込", false, this::load); button(zh ? "关闭" : "閉じる", false, this::finish); return;
        }
        submitted = false;
        text(zh ? "将按以下顺序执行：" : "次の順番で実行します：", 15, false);
        JSONArray steps = scene.optJSONArray("steps");
        for (int i = 0; i < steps.length(); i++) {
            JSONObject step = steps.optJSONObject(i);
            text((i + 1) + ". " + StoreWidgetScenePolicy.deviceName(step, devices, zh) + " · " + StoreWidgetScenePolicy.action(step, zh), 15, false);
        }
        if (StoreWidgetScenePolicy.indoorOff(scene, devices)) text(zh ? "关室内灯前读取照度，仅10–20才按。低于10或读取失败时跳过。" : "室内照明は明るさ10–20のときだけ押します。10未満や取得失敗では押しません。", 13, false);
        text(zh ? "失败后继续处理下一设备，失败操作不会自动重试。" : "失敗した操作は自動で再実行せず、次の機器へ進みます。", 13, false);
        unlock = null;
        if (StoreWidgetScenePolicy.needsUnlock(scene)) {
            unlock = new CheckBox(this); unlock.setText(zh ? "将允许开门，我已确认现场安全。" : "ドアを開けられる状態になります。現地の安全を確認しました。"); unlock.setTextSize(13); unlock.setTextColor(0xFF173F35); content.addView(unlock);
        }
        Button confirm = button(zh ? "确认执行场景" : "確認して実行", true, this::execute);
        if (unlock != null) { confirm.setEnabled(false); unlock.setOnCheckedChangeListener((view, checked) -> confirm.setEnabled(checked)); }
        button(zh ? "重新读取" : "再読込", false, this::load); button(zh ? "取消" : "キャンセル", false, this::finish);
    }
    void execute() {
        if (!alive() || !resumed || busy || submitted) return;
        long now = android.os.SystemClock.elapsedRealtime();
        if (!bound() || !StoreWidgetScenePolicy.validScene(scene) || now < loadedAt || now - loadedAt > 30_000
            || StoreWidgetScenePolicy.needsUnlock(scene) && (unlock == null || !unlock.isChecked())) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
        submitted = true; busy = true; requestId = java.util.UUID.randomUUID().toString(); pollStarted = now;
        String id = requestId; boolean allowUnlock = unlock != null && unlock.isChecked();
        header(); text(zh ? "开始执行场景…" : "シーンの実行を開始中…", 16, true);
        new Thread(() -> {
            JSONObject result = null; Exception error = null;
            try { result = sendScene(id, allowUnlock); } catch (Exception problem) { error = problem; }
            JSONObject run = result; Exception failure = error;
            runOnUiThread(() -> {
                if (!alive()) return;
                busy = false;
                if (!bound()) { failure(new InventoryApiClient.ApiException(409, "changed")); return; }
                if (failure instanceof InventoryApiClient.ApiException && ((InventoryApiClient.ApiException)failure).status < 500) {
                    requestId = null; submitted = false; failure(failure);
                } else if (failure != null) load(); // A lost response only reads this request ID. Never resend it.
                else showRun(run);
            });
        }, "foundr1-widget-scene-command").start();
    }
    void showRun(JSONObject run) {
        header(); scene = null; submitted = true; runActive = false;
        if (run == null || requestId == null || !requestId.equals(run.optString("id")) || !key.equals(run.optString("sceneId")) || run.optJSONArray("steps") == null) {
            text(zh ? "结果未确认，请先读取结果，避免重复执行。" : "結果は未確認です。再実行せず、結果を確認してください。", 16, true);
        } else {
            boolean running = "running".equals(run.optString("status"));
            runActive = running;
            text(running ? zh ? "执行中" : "実行中" : "interrupted".equals(run.optString("status")) ? zh ? "执行中断，请确认设备状态。" : "実行が中断されました。機器の状態を確認してください。" : zh ? "执行结果" : "実行結果", 18, true);
            JSONArray steps = run.optJSONArray("steps");
            for (int i = 0; i < steps.length(); i++) {
                JSONObject step = steps.optJSONObject(i); if (step == null) continue;
                text((i + 1) + ". " + StoreWidgetScenePolicy.deviceName(step, null, zh) + " · " + StoreWidgetScenePolicy.action(step, zh) + " — " + StoreWidgetScenePolicy.status(step.optString("status"), zh), 14, false);
                if (!step.optString("reason").isEmpty()) text(StoreWidgetScenePolicy.reason(step.optString("reason"), zh), 12, false);
            }
            text(zh ? "已发送表示设备已接受指令，实际状态请在设备页确认。" : "送信済みは指示の受付です。実際の状態は機器ページで確認してください。", 12, false);
            if (running && resumed && withinObservationWindow()) handler.postDelayed(this::load, 5_000);
            if (running && !withinObservationWindow()) text(zh ? "自动检查已停止，请按需读取结果。" : "自動確認を終了しました。必要に応じて結果を確認してください。", 13, false);
        }
        button(zh ? "读取结果" : "結果を確認", false, this::load); devicePage(); button(zh ? "关闭" : "閉じる", false, this::finish);
    }
    private boolean withinObservationWindow() {
        long now = android.os.SystemClock.elapsedRealtime(); return now >= pollStarted && now - pollStarted < 180_000;
    }
    private void failure(Exception error) {
        busy = false; scene = null; header();
        text(requestId == null ? StoreWidgetDevicePolicy.error(error, zh) : zh ? "结果未确认，请先读取结果，避免重复执行。" : "結果は未確認です。再実行せず、結果を確認してください。", 15, true);
        if (bound()) button(zh ? requestId == null ? "重新读取" : "读取结果" : requestId == null ? "再読込" : "結果を確認", false, this::load);
        devicePage(); button(zh ? "关闭" : "閉じる", false, this::finish);
    }
    private void devicePage() {
        button(zh ? "打开设备页" : "機器ページを開く", false, () -> {
            startActivity(new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("foundr1_href", "/store/devices?storeId=" + android.net.Uri.encode(store == null ? "" : store))); finish();
        });
    }
    private void header() { content.removeAllViews(); text(name, 20, true); text(InventoryWidgetProvider.storeName(this, widgetId), 14, false); }
    private void text(String value, int size, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(bold ? 0xFF173F35 : 0xFF526A5F);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD); view.setPadding(0, dp(5), 0, dp(7)); content.addView(view);
    }
    private Button button(String label, boolean primary, Runnable click) {
        Button button = new Button(this); button.setText(label); button.setTextSize(15); button.setAllCaps(false); button.setTextColor(primary ? 0xFFFFFFFF : 0xFF173F35);
        GradientDrawable background = new GradientDrawable(); background.setCornerRadius(dp(10)); background.setColor(primary ? 0xFF173F35 : 0xFFEDF3E9);
        button.setBackground(background); button.setOnClickListener(view -> click.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)); params.topMargin = dp(8); content.addView(button, params); return button;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onSaveInstanceState(Bundle saved) { if (requestId != null) { saved.putString("sceneRequest", requestId); saved.putLong("pollStarted", pollStarted); } super.onSaveInstanceState(saved); }
    @Override protected void onResume() { super.onResume(); resumed = true; if (runActive && requestId != null && !busy) load(); }
    @Override protected void onPause() { resumed = false; handler.removeCallbacksAndMessages(null); super.onPause(); }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy(); }
}
