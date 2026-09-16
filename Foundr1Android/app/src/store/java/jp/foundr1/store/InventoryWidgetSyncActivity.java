package jp.foundr1.store;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

/** Read-only detail of the operation shown on the widget, in the same store scope. */
public class InventoryWidgetSyncActivity extends Activity {
    private int widgetId;
    private String language;
    private boolean chinese;
    private LinearLayout content;
    private final SharedPreferences.OnSharedPreferenceChangeListener listener = (prefs, key) -> {
        if (key != null && key.startsWith(InventoryWidgetProvider.storeId(this, widgetId) + ":")) render();
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId) == null) { finish(); return; }
        language = InventoryWidgetProvider.language(this, widgetId);
        chinese = InventoryWidgetProvider.LANGUAGE_ZH.equals(language);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.WHITE);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(24), dp(20), dp(24));
        scroll.addView(content);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(scroll);
        render();
    }

    @Override protected void onStart() {
        super.onStart();
        if (content == null) return;
        InventoryWidgetData.prefs(this).registerOnSharedPreferenceChangeListener(listener);
        InventoryWidgetProvider.refreshWidget(this, widgetId);
    }

    @Override protected void onStop() {
        InventoryWidgetData.prefs(this).unregisterOnSharedPreferenceChangeListener(listener);
        super.onStop();
    }

    private void render() {
        if (content == null || isFinishing() || isDestroyed()) return;
        content.removeAllViews();
        InventoryWidgetData data = InventoryWidgetData.read(this, widgetId);
        text(chinese ? "平台同步结果" : "同期結果", 22, 0xFF183B2E);
        String brand = InventoryWidgetProvider.brandName(this, widgetId);
        text(InventoryWidgetProvider.storeName(this, widgetId) + " · "
            + (brand.isEmpty() ? (chinese ? "全部品牌" : "全ブランド") : brand), 14, 0xFF526A5F);
        if (!data.syncError.isEmpty() || !data.inventoryError.isEmpty()) {
            String error = data.syncError.isEmpty() ? data.inventoryError : data.syncError;
            text(InventoryWidgetProvider.errorText(error, chinese), 14, 0xFFA12828);
        }
        if (data.latestRun == null) {
            boolean loading = data.syncCheckedAt == 0 && data.syncError.isEmpty() && data.inventoryError.isEmpty();
            text(loading ? (chinese ? "正在读取同步结果…" : "同期結果を読み込み中…")
                : (chinese ? "当前没有可显示的最近操作。" : "表示できる直近の操作はありません。"), 16, 0xFF526A5F);
        } else {
            String action = "available".equals(data.latestRun.optString("action"))
                ? (chinese ? "恢复销售" : "販売再開") : (chinese ? "设置缺货" : "欠品登録");
            text(InventoryWidgetData.runLabel(data.latestRun, language) + " → " + action, 18, 0xFF183B2E);
            text((chinese ? "操作时间：" : "操作時刻：")
                + InventoryWidgetProvider.time(InventoryWidgetData.epoch(data.latestRun.optString("createdAt"))), 13, 0xFF526A5F);
            for (JSONObject platform : InventoryWidgetData.platforms(data.latestRun)) {
                String status = InventoryWidgetData.status(platform);
                boolean failed = "failed".equals(status) || "timed_out".equals(status);
                text(InventoryWidgetPolicy.platformName(platform.optString("platform"), chinese) + "    "
                    + InventoryWidgetPolicy.statusText(status, chinese), 16,
                    failed ? 0xFFA12828 : "succeeded".equals(status) ? 0xFF134E3A : 0xFF766023);
                if (failed) text(failureHelp(data.latestRun, platform.optString("platform")), 13, 0xFF526A5F);
            }
            text((chinese ? "结果确认时间：" : "結果の確認時刻：") + InventoryWidgetProvider.time(data.syncCheckedAt), 13, 0xFF526A5F);
            if (data.pending()) text(chinese
                ? "部分平台尚未完成。后台会短时继续查询，稍后也可以点击刷新确认。"
                : "未完了のプラットフォームがあります。しばらく自動で確認します。後から再読込することもできます。", 14, 0xFF526A5F);
        }
        button(chinese ? "刷新结果" : "結果を再読込", () -> {
            InventoryWidgetProvider.refreshWidget(this, widgetId);
            android.widget.Toast.makeText(this, chinese ? "正在刷新…" : "再読込中…", android.widget.Toast.LENGTH_SHORT).show();
        });
        if (InventoryWidgetData.denied(data.inventoryError) || InventoryWidgetData.denied(data.syncError)) {
            button(chinese ? "打开 Foundr1 Store" : "Foundr1 Storeを開く", () -> {
                Intent intent = new Intent(this, MainActivity.class);
                intent.putExtra("foundr1_href", "/store");
                startActivity(intent);
                finish();
            });
        }
        button(chinese ? "关闭" : "閉じる", this::finish);
    }

    private String failureHelp(JSONObject run, String platform) {
        JSONArray failures = run.optJSONArray("failedCommands");
        for (int i = 0; failures != null && i < failures.length(); i++) {
            JSONObject failure = failures.optJSONObject(i);
            if (failure == null || !platform.equals(failure.optString("platform"))) continue;
            String error = failure.optString("error").toLowerCase(java.util.Locale.ROOT);
            if (error.contains("login") || error.contains("auth") || error.contains("session"))
                return chinese ? "请打开该平台并重新登录，再在 Store 中重试。" : "連携先で再ログインし、Storeで再実行してください。";
            if (error.contains("timeout") || error.contains("timed out"))
                return chinese ? "平台响应超时，请在 Store 中查看并重试。" : "連携先がタイムアウトしました。Storeで確認して再実行してください。";
        }
        return chinese ? "请在 Store 的销售状态页面查看失败详情并重试。" : "Storeの販売状態画面で詳細を確認し、再実行してください。";
    }

    private void text(String value, int size, int color) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        text.setPadding(0, dp(7), 0, dp(7));
        content.addView(text, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private void button(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(0xFF134E3A);
        button.setBackgroundResource(R.drawable.inventory_widget_button);
        button.setGravity(Gravity.CENTER);
        button.setOnClickListener(view -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        params.topMargin = dp(12);
        content.addView(button, params);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
