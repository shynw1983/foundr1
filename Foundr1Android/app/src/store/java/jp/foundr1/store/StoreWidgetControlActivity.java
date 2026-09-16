package jp.foundr1.store;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;

/** A widget tap opens a small, authenticated control sheet, never a network broadcast or queued mutation. */
public class StoreWidgetControlActivity extends Activity {
    static final String EXTRA_STORE = "control_store", EXTRA_CONTROL = "control_key", EXTRA_ENABLED = "control_enabled",
        EXTRA_VERSION = "control_version", EXTRA_SESSION = "control_session";
    private int widgetId;
    private String store, control, session;
    private boolean zh, busy;
    private LinearLayout content;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        store = getIntent().getStringExtra(EXTRA_STORE);
        control = getIntent().getStringExtra(EXTRA_CONTROL);
        session = InventoryApiClient.sessionKey();
        zh = "zh".equals(InventoryWidgetProvider.language(this, widgetId));
        if (AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId) == null || store == null || store.isEmpty()
            || !store.equals(InventoryWidgetProvider.storeId(this, widgetId))
            || !(StoreWidgetControlsPolicy.RECEPTION.equals(control) || StoreWidgetControlsPolicy.AWAY.equals(control))) { finish(); return; }
        FrameLayout backdrop = new FrameLayout(this);
        backdrop.setPadding(dp(18), dp(24), dp(18), dp(24));
        backdrop.setOnClickListener(view -> { if (!busy) finish(); });
        backdrop.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(dp(18), insets.getSystemWindowInsetTop() + dp(24), dp(18), insets.getSystemWindowInsetBottom() + dp(24));
            return insets;
        });
        ScrollView sheet = new ScrollView(this);
        sheet.setFillViewport(false); sheet.setBackground(background(0xFFEDF3E9, 22));
        sheet.setOnClickListener(view -> {});
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(22), dp(18), dp(22), dp(18)); sheet.addView(content);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(Math.min(dp(420), getResources().getDisplayMetrics().widthPixels - dp(36)), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        backdrop.addView(sheet, params); setContentView(backdrop);
        // A restored activity must never replay an uncertain write after process death or rotation.
        StoreWidgetControlsData cached = StoreWidgetControlsData.read(this, store);
        if (state == null && StoreWidgetControlsPolicy.AWAY.equals(control) && getIntent().hasExtra(EXTRA_ENABLED)
            && session.equals(getIntent().getStringExtra(EXTRA_SESSION)) && cached.canToggle()
            && cached.preference().optString("version").equals(getIntent().getStringExtra(EXTRA_VERSION))) {
            toggle(getIntent().getBooleanExtra(EXTRA_ENABLED, false), getIntent().getStringExtra(EXTRA_VERSION));
        } else load();
    }
    @Override protected void onSaveInstanceState(Bundle state) { state.putBoolean("opened", true); super.onSaveInstanceState(state); }
    private boolean alive() { return !isFinishing() && !isDestroyed(); }
    private void header() {
        content.removeAllViews();
        text(StoreWidgetControlsPolicy.title(control, zh), 22, true, 0xFF173F35);
        text(InventoryWidgetProvider.storeName(this, widgetId) + (StoreWidgetControlsPolicy.AWAY.equals(control)
            ? (zh ? " · 当前账号" : " · ログイン中のアカウント") : (zh ? " · 整家门店" : " · 店舗全体")), 13, false, 0xFF526A5F);
    }
    private void loading(boolean saving) {
        busy = true; header();
        text(saving ? (zh ? "正在保存…" : "保存中…") : (zh ? "正在读取当前状态…" : "現在の状態を確認中…"), 17, false, 0xFF173F35);
    }
    private void load() {
        loading(false);
        Context context = getApplicationContext();
        new Thread(() -> {
            StoreWidgetControlsData.refresh(context, store, () -> !session.equals(InventoryApiClient.sessionKey()));
            runOnUiThread(() -> {
                renderWidgets(context);
                if (!alive()) return;
                busy = false;
                if (!session.equals(InventoryApiClient.sessionKey())) { failure(null); return; }
                show(StoreWidgetControlsData.read(context, store));
            });
        }, "foundr1-widget-control-read").start();
    }
    private void show(StoreWidgetControlsData data) {
        header();
        if (StoreWidgetControlsPolicy.RECEPTION.equals(control)) {
            if (!data.receptionFresh()) { failure(null); return; }
            text(zh ? "选择网络预约模式。随时可切回自动。" : "Web予約の受付方法を選択してください。いつでも自動に戻せます。", 14, false, 0xFF526A5F);
            String current = data.operation.optString("acceptanceMode");
            for (String mode : new String[]{"auto", "force_open", "force_closed"}) {
                button(StoreWidgetControlsPolicy.mode(mode, zh) + (current.equals(mode) ? (zh ? "  · 当前" : "  · 現在") : ""), current.equals(mode), () -> reception(mode));
            }
        } else {
            JSONObject pref = data.preference();
            if (!data.notificationFresh()) { failure(null); return; }
            if (pref == null || !data.notification.optBoolean("ready")) text(zh ? "请先在 App 中设置当前账号的离店距离。" : "アプリでこのアカウントの離店距離を設定してください。", 16, false, 0xFF173F35);
            else {
                boolean enabled = pref.optBoolean("enabled");
                text(enabled ? (zh ? "离店提醒已开启" : "離店通知はオンです") : (zh ? "离店提醒已关闭" : "離店通知はオフです"), 18, true, 0xFF173F35);
                text((zh ? "离店 " : "離店 ") + pref.optInt("exitRadius") + " m  /  " + (zh ? "回店 " : "帰店 ") + pref.optInt("enterRadius") + " m", 14, false, 0xFF526A5F);
                if (data.canToggle()) button(enabled ? (zh ? "关闭离店提醒" : "離店通知をオフ") : (zh ? "开启离店提醒" : "離店通知をオン"), true,
                    () -> toggle(!enabled, pref.optString("version")));
                else text(zh ? "当前账号没有修改通知规则的权限。" : "このアカウントには通知設定の変更権限がありません。", 14, false, 0xFF526A5F);
            }
            button(zh ? "通知与距离设置" : "通知・距離の設定", false, this::openApp);
        }
        button(zh ? "关闭" : "閉じる", false, this::finish);
    }
    private interface Change { void run(Context context) throws Exception; }
    private void mutate(Change change) {
        if (busy || !session.equals(InventoryApiClient.sessionKey())
            || !store.equals(InventoryWidgetProvider.storeId(this, widgetId))) { failure(null); return; }
        if (!StoreWidgetControlsData.beginMutation(store, session)) {
            header(); text(zh ? "这家店的设置正在保存，请稍后刷新。" : "この店舗の設定を保存中です。少し待って再確認してください。", 16, false, 0xFF173F35);
            button(zh ? "关闭" : "閉じる", false, this::finish); return;
        }
        loading(true);
        Context context = getApplicationContext();
        // Invalidate the actionable display until the server confirms the result.
        StoreWidgetControlsData.error(context, store, session, control, new java.io.IOException("pending"));
        renderWidgets(context);
        new Thread(() -> {
            Exception failure = null;
            try { change.run(context); } catch (Exception error) {
                failure = error;
                StoreWidgetControlsData.error(context, store, session, control, error);
            } finally { StoreWidgetControlsData.endMutation(store, session); }
            Exception result = failure;
            runOnUiThread(() -> {
                renderWidgets(context);
                if (!alive()) return;
                busy = false;
                if (result != null || !session.equals(InventoryApiClient.sessionKey())) { failure(result); return; }
                android.widget.Toast.makeText(this, zh ? "已保存" : "保存しました", android.widget.Toast.LENGTH_SHORT).show();
                finish();
            });
        }, "foundr1-widget-control-save").start();
    }
    private void reception(String mode) {
        mutate(context -> {
            InventoryApiClient.setReception(store, mode, session);
            JSONObject saved = InventoryApiClient.loadOperation(store);
            StoreWidgetControlsData.save(context, store, session, "reception", saved);
        });
    }
    private void toggle(boolean enabled, String version) {
        mutate(context -> {
            JSONObject saved = InventoryApiClient.setNotificationPreference(store, enabled, version, session);
            JSONObject pref = saved.optJSONObject("preference");
            if (!saved.optBoolean("ok") || !store.equals(saved.optString("storeId")) || pref == null
                || pref.optBoolean("enabled") != enabled) throw new java.io.IOException("Result unconfirmed");
            StoreWidgetControlsData.save(context, store, session, "away", saved);
            StoreWidgetControlsData.applyRules(context, session, saved);
            if (enabled && session.equals(InventoryApiClient.sessionKey())) StoreOrderPush.refresh(context);
        });
    }
    private void failure(Exception error) {
        busy = false; header();
        int status = error instanceof InventoryApiClient.ApiException ? ((InventoryApiClient.ApiException)error).status : 0;
        String message = status == 409 ? (zh ? "设置已变化，请重新读取后再操作。" : "設定が変更されました。再確認して操作してください。")
            : status == 401 || session.isEmpty() ? (zh ? "请打开 Store 重新登录。" : "Storeでログインしてください。")
            : status == 403 ? (zh ? "当前账号没有操作权限。" : "操作する権限がありません。")
            : (zh ? "结果尚未确认。请刷新查看当前设置。" : "結果を確認できません。再読込して現在の設定を確認してください。");
        text(message, 16, false, 0xFF924732);
        button(zh ? "重新读取" : "再読込", true, this::load);
        button(zh ? "在 App 中查看" : "アプリで確認", false, this::openApp);
        button(zh ? "关闭" : "閉じる", false, this::finish);
    }
    private void openApp() {
        String path = StoreWidgetControlsPolicy.RECEPTION.equals(control) ? "/store/orders?storeId=" + store + "#reception-settings" : "/store/notifications";
        startActivity(new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("foundr1_href", path));
        finish();
    }
    private static void renderWidgets(Context context) { for (int id : InventoryWidgetProvider.widgetIds(context)) InventoryWidgetProvider.renderWidget(context, id); }
    private void text(String value, int size, boolean bold, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setPadding(0, dp(5), 0, dp(9));
        content.addView(view, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }
    private void button(String label, boolean primary, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setTextSize(16); button.setAllCaps(false);
        button.setTextColor(primary ? 0xFFF5F8F5 : 0xFF173F35); button.setBackground(background(primary ? 0xFF244C40 : 0xFFDCE7DB, 12));
        button.setStateListAnimator(null); button.setOnClickListener(view -> { if (!busy) action.run(); });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)); params.topMargin = dp(8); content.addView(button, params);
    }
    private GradientDrawable background(int color, int radius) { GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radius)); return drawable; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
