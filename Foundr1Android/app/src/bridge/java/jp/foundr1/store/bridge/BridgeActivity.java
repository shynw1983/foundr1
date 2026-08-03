package jp.foundr1.store.bridge;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import jp.foundr1.store.R;

public class BridgeActivity extends Activity {
    private static final int COLOR_INK = Color.rgb(31, 37, 34);
    private static final int COLOR_MUTED = Color.rgb(96, 105, 100);
    private static final int COLOR_LINE = Color.rgb(218, 224, 220);
    private static final int COLOR_CANVAS = Color.rgb(244, 247, 245);
    private static final int COLOR_HEALTHY = Color.rgb(24, 112, 74);
    private static final int COLOR_ATTENTION = Color.rgb(183, 121, 31);
    private static final int COLOR_ERROR = Color.rgb(190, 24, 45);

    private EditText endpointInput;
    private EditText tokenInput;
    private EditText storeIdInput;
    private EditText deviceNameInput;
    private TextView overallTitle;
    private TextView overallDetail;
    private TextView uberStage;
    private TextView bridgeStage;
    private TextView osStage;
    private TextView accessibilityRow;
    private TextView notificationRow;
    private TextView realtimeRow;
    private TextView batteryRow;
    private TextView recentOrder;
    private TextView queueSummary;
    private LinearLayout statusCard;
    private LinearLayout advancedLayout;
    private Button repairButton;
    private Button selfTestButton;
    private boolean healthReceiverRegistered = false;
    private final BroadcastReceiver healthReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            updateStatus();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildLayout();
        requestNotificationPermissionIfNeeded();
        BridgeServiceStarter.ensureStarted(this, "activity_create");
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (!healthReceiverRegistered) {
            IntentFilter filter = new IntentFilter(BridgeHealthState.ACTION_CHANGED);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(healthReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(healthReceiver, filter);
            }
            healthReceiverRegistered = true;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        BridgeServiceStarter.ensureStarted(this, "activity_resume");
        BridgeRealtimeClient.start(this);
        updateStatus();
    }

    @Override
    protected void onStop() {
        if (healthReceiverRegistered) {
            try { unregisterReceiver(healthReceiver); } catch (Exception ignored) {}
            healthReceiverRegistered = false;
        }
        super.onStop();
    }

    private void buildLayout() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(COLOR_CANVAS);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(20), dp(20), dp(20), dp(28));
        scrollView.addView(page);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(0, 0, 0, dp(18));
        ImageView icon = new ImageView(this);
        try { icon.setImageDrawable(getPackageManager().getApplicationIcon(getPackageName())); } catch (Exception ignored) {}
        header.addView(icon, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        headingParams.leftMargin = dp(12);
        header.addView(heading, headingParams);
        heading.addView(text("Foundr1 Bridge", 23, COLOR_INK, Typeface.BOLD));
        heading.addView(text("for Uber Eats  ·  v" + BridgeStatusReporter.versionName(this), 13, COLOR_MUTED, Typeface.NORMAL));
        page.addView(header);

        statusCard = new LinearLayout(this);
        statusCard.setOrientation(LinearLayout.VERTICAL);
        statusCard.setPadding(dp(20), dp(20), dp(20), dp(20));
        overallTitle = text("接続を確認しています", 25, COLOR_INK, Typeface.BOLD);
        overallDetail = text("数秒お待ちください", 14, COLOR_MUTED, Typeface.NORMAL);
        overallDetail.setPadding(0, dp(7), 0, 0);
        statusCard.addView(overallTitle);
        statusCard.addView(overallDetail);
        page.addView(statusCard, matchWidth(dp(12)));

        repairButton = addPrimaryButton(page, "接続を修復する", view -> repairConnection());
        repairButton.setVisibility(View.GONE);

        LinearLayout chain = section(page, "注文連携");
        LinearLayout chainRow = new LinearLayout(this);
        chainRow.setGravity(Gravity.CENTER_VERTICAL);
        uberStage = chainStage("Uber Orders");
        bridgeStage = chainStage("Bridge");
        osStage = chainStage("Foundr1 OS");
        chainRow.addView(uberStage, weighted());
        chainRow.addView(text("→", 18, COLOR_MUTED, Typeface.NORMAL));
        chainRow.addView(bridgeStage, weighted());
        chainRow.addView(text("→", 18, COLOR_MUTED, Typeface.NORMAL));
        chainRow.addView(osStage, weighted());
        chain.addView(chainRow);

        LinearLayout checks = section(page, "システム状態");
        accessibilityRow = statusRow(checks, "画面読み取り");
        notificationRow = statusRow(checks, "Uber 通知読み取り");
        realtimeRow = statusRow(checks, "Foundr1 OS 接続");
        batteryRow = statusRow(checks, "バックグラウンド保護");

        LinearLayout activity = section(page, "最近の動作");
        recentOrder = text("最近の注文：まだありません", 15, COLOR_INK, Typeface.NORMAL);
        queueSummary = text("未送信：0件", 14, COLOR_MUTED, Typeface.NORMAL);
        queueSummary.setPadding(0, dp(8), 0, 0);
        activity.addView(recentOrder);
        activity.addView(queueSummary);

        addPrimaryButton(page, "Uber Orders を開く", view -> openUberOrders());
        selfTestButton = addSecondaryButton(page, "接続を診断", view -> runSelfTest());

        Button advancedButton = addTextButton(page, "管理者設定を表示", null);
        advancedLayout = new LinearLayout(this);
        advancedLayout.setOrientation(LinearLayout.VERTICAL);
        advancedLayout.setVisibility(View.GONE);
        advancedButton.setOnClickListener(view -> {
            boolean show = advancedLayout.getVisibility() != View.VISIBLE;
            advancedLayout.setVisibility(show ? View.VISIBLE : View.GONE);
            advancedButton.setText(show ? "管理者設定を閉じる" : "管理者設定を表示");
        });
        page.addView(advancedLayout);
        buildAdvancedSettings(advancedLayout);

        setContentView(scrollView);
        updateStatus();
    }

    private void buildAdvancedSettings(LinearLayout layout) {
        TextView warning = text(
            "店舗管理者向けの設定です。通常の営業中は変更しないでください。",
            13,
            COLOR_MUTED,
            Typeface.NORMAL
        );
        warning.setPadding(0, dp(12), 0, dp(10));
        layout.addView(warning);
        endpointInput = addInput(layout, "接続先 URL", BridgeConfig.endpoint(this), false);
        tokenInput = addInput(layout, "Bridge Token", BridgeConfig.token(this), true);
        storeIdInput = addInput(layout, "店舗 ID（必須）", BridgeConfig.storeId(this), false);
        deviceNameInput = addInput(layout, "端末名", BridgeConfig.deviceName(this), false);
        addPrimaryButton(layout, "設定を保存して再接続", view -> {
            saveConfig();
            BridgeRealtimeClient.disconnect(this);
            BridgeRealtimeClient.start(this);
            BridgeServiceStarter.ensureStarted(this, "settings_saved");
            Toast.makeText(this, "設定を保存しました", Toast.LENGTH_SHORT).show();
            updateStatus();
        });
        addSecondaryButton(layout, "画面読み取り設定を開く", view -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        addSecondaryButton(layout, "通知アクセス設定を開く", view -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        addSecondaryButton(layout, "電池制限を解除する", view -> openBatterySettings());
    }

    private void updateStatus() {
        if (overallTitle == null) return;
        BridgeHealthState.Snapshot health = BridgeHealthState.snapshot(this);
        boolean accessibilityAuthorized = isAccessibilityServiceEnabled();
        boolean notificationAuthorized = isNotificationListenerEnabled();
        boolean notificationsAllowed = ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled();
        boolean batteryProtected = isIgnoringBatteryOptimizations();
        boolean configured = !BridgeConfig.endpoint(this).isEmpty()
            && !BridgeConfig.token(this).isEmpty()
            && !BridgeConfig.storeId(this).isEmpty();

        String level;
        String problem;
        if (!notificationsAllowed) {
            level = "error";
            problem = "Bridge の状態通知を許可してください";
        } else if (!accessibilityAuthorized) {
            level = "error";
            problem = "画面読み取りを有効にしてください";
        } else if (!notificationAuthorized) {
            level = "error";
            problem = "Uber の通知アクセスを有効にしてください";
        } else if (!configured) {
            level = "error";
            problem = "店舗の接続設定が未完了です";
        } else {
            level = BridgeStatusReporter.healthLevel(health);
            problem = BridgeStatusReporter.problem(health);
        }

        int accent = "healthy".equals(level) ? COLOR_HEALTHY : "attention".equals(level) ? COLOR_ATTENTION : COLOR_ERROR;
        int soft = "healthy".equals(level)
            ? Color.rgb(235, 246, 240)
            : "attention".equals(level) ? Color.rgb(251, 246, 233) : Color.rgb(253, 237, 240);
        overallTitle.setText("healthy".equals(level) ? "✓ 注文連携は正常です" : "attention".equals(level) ? "△ 確認中の項目があります" : "！注文連携を確認してください");
        overallTitle.setTextColor(accent);
        overallDetail.setText("healthy".equals(level) ? "Uber Orders から Foundr1 OS まで接続されています" : problem);
        statusCard.setBackground(cardBackground(soft, accent, 14));
        getWindow().setStatusBarColor(accent);
        getWindow().setNavigationBarColor(accent);

        updateStage(uberStage, accessibilityAuthorized && health.accessibilityConnected);
        updateStage(bridgeStage, notificationAuthorized && health.notificationConnected && health.pendingCount == 0);
        updateStage(osStage, health.realtimeConnected);
        updateRow(accessibilityRow, accessibilityAuthorized && health.accessibilityConnected, accessibilityAuthorized ? "接続確認中" : "設定が必要");
        updateRow(notificationRow, notificationAuthorized && health.notificationConnected, notificationAuthorized ? "接続確認中" : "設定が必要");
        updateRow(realtimeRow, health.realtimeConnected, health.realtimeConnected ? "正常" : "再接続中");
        updateRow(batteryRow, batteryProtected, batteryProtected ? "制限なし" : "解除が必要");

        if (health.lastOrderCode.isEmpty()) {
            recentOrder.setText("最近の注文：まだありません");
        } else {
            recentOrder.setText("最近の注文：" + health.lastOrderCode + "  ·  " + formatTime(health.lastOrderAt));
        }
        queueSummary.setText(health.pendingCount == 0 ? "未送信：0件" : "未送信：" + health.pendingCount + "件（自動再送中）");
        queueSummary.setTextColor(health.pendingCount == 0 ? COLOR_MUTED : COLOR_ATTENTION);

        updateRepairButton(
            level,
            notificationsAllowed,
            accessibilityAuthorized,
            notificationAuthorized,
            health,
            batteryProtected,
            configured
        );
    }

    private void updateRepairButton(
        String level,
        boolean notificationsAllowed,
        boolean accessibilityAuthorized,
        boolean notificationAuthorized,
        BridgeHealthState.Snapshot health,
        boolean batteryProtected,
        boolean configured
    ) {
        if (repairButton == null) return;
        if ("healthy".equals(level)) {
            repairButton.setVisibility(View.GONE);
            return;
        }
        repairButton.setVisibility(View.VISIBLE);
        if (!notificationsAllowed) repairButton.setText("Bridge の通知を許可する");
        else if (!accessibilityAuthorized) repairButton.setText("画面読み取りを有効にする");
        else if (!notificationAuthorized) repairButton.setText("Uber 通知読み取りを有効にする");
        else if (!health.notificationConnected && isXiaomi()) repairButton.setText("Xiaomi の自動起動を確認する");
        else if (!health.notificationConnected) repairButton.setText("通知読み取りを再接続する");
        else if (!batteryProtected) repairButton.setText("バックグラウンド制限を解除する");
        else if (!configured) repairButton.setText("店舗の接続設定を開く");
        else repairButton.setText("今すぐ再接続する");
    }

    private void repairConnection() {
        BridgeHealthState.Snapshot health = BridgeHealthState.snapshot(this);
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        boolean notificationsAllowed = notificationManager != null && notificationManager.areNotificationsEnabled();
        if (!notificationsAllowed) {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            startActivity(intent);
            return;
        }
        if (!isAccessibilityServiceEnabled()) {
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            return;
        }
        if (!isNotificationListenerEnabled()) {
            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
            return;
        }
        if (!health.notificationConnected) {
            UberNotificationListenerService.requestConnection(this);
            if (isXiaomi()) {
                openAutoStartSettings();
            } else {
                Toast.makeText(this, "通知読み取りを再接続しています", Toast.LENGTH_SHORT).show();
            }
            return;
        }
        if (!isIgnoringBatteryOptimizations()) {
            openBatterySettings();
            return;
        }
        if (BridgeConfig.storeId(this).isEmpty() || BridgeConfig.token(this).isEmpty()) {
            advancedLayout.setVisibility(View.VISIBLE);
            Toast.makeText(this, "店舗 ID と Bridge Token を確認してください", Toast.LENGTH_LONG).show();
            return;
        }
        BridgeRealtimeClient.disconnect(this);
        BridgeRealtimeClient.start(this);
        BridgeServiceStarter.ensureStarted(this, "manual_repair");
        Toast.makeText(this, "再接続しています", Toast.LENGTH_SHORT).show();
    }

    private void runSelfTest() {
        selfTestButton.setEnabled(false);
        selfTestButton.setText("接続を確認しています…");
        try {
            JSONObject payload = new JSONObject();
            payload.put("message", "Foundr1 Bridge self test");
            BridgeUploader.upload(this, "test", "", payload, success -> runOnUiThread(() -> {
                selfTestButton.setEnabled(true);
                selfTestButton.setText(success ? "✓ 接続テスト成功" : "接続テスト失敗 — 設定を確認");
                selfTestButton.setTextColor(success ? COLOR_HEALTHY : COLOR_ERROR);
                updateStatus();
            }));
        } catch (Exception error) {
            selfTestButton.setEnabled(true);
            selfTestButton.setText("接続テスト失敗 — 設定を確認");
            selfTestButton.setTextColor(COLOR_ERROR);
        }
    }

    private LinearLayout section(LinearLayout page, String title) {
        TextView label = text(title, 13, COLOR_MUTED, Typeface.BOLD);
        label.setPadding(dp(2), dp(20), 0, dp(7));
        page.addView(label);
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(dp(16), dp(14), dp(16), dp(14));
        section.setBackground(cardBackground(Color.WHITE, COLOR_LINE, 12));
        page.addView(section, matchWidth(0));
        return section;
    }

    private TextView chainStage(String label) {
        TextView view = text("○\n" + label, 13, COLOR_MUTED, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(4), dp(5), dp(4), dp(5));
        return view;
    }

    private void updateStage(TextView view, boolean ok) {
        String label = view.getText().toString().replaceFirst("^[✓○]\n", "");
        view.setText((ok ? "✓" : "○") + "\n" + label);
        view.setTextColor(ok ? COLOR_HEALTHY : COLOR_MUTED);
    }

    private TextView statusRow(LinearLayout parent, String label) {
        TextView row = text(label, 15, COLOR_INK, Typeface.NORMAL);
        row.setPadding(0, dp(9), 0, dp(9));
        row.setTag(label);
        parent.addView(row);
        return row;
    }

    private void updateRow(TextView row, boolean ok, String fallback) {
        String label = String.valueOf(row.getTag());
        row.setText(label + "    " + (ok ? "✓ 正常" : "△ " + fallback));
        row.setTextColor(ok ? COLOR_INK : COLOR_ATTENTION);
    }

    private EditText addInput(LinearLayout layout, String label, String value, boolean secret) {
        TextView textView = text(label, 13, COLOR_MUTED, Typeface.BOLD);
        textView.setPadding(0, dp(11), 0, dp(4));
        layout.addView(textView);
        EditText editText = new EditText(this);
        editText.setText(value);
        editText.setSingleLine(true);
        editText.setTextSize(14);
        editText.setTextColor(COLOR_INK);
        editText.setBackground(cardBackground(Color.WHITE, COLOR_LINE, 8));
        editText.setPadding(dp(12), dp(10), dp(12), dp(10));
        if (secret) editText.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(editText, matchWidth(0));
        return editText;
    }

    private Button addPrimaryButton(LinearLayout layout, String label, View.OnClickListener listener) {
        Button button = button(label, Color.WHITE, COLOR_INK, listener);
        layout.addView(button, matchWidth(dp(12)));
        return button;
    }

    private Button addSecondaryButton(LinearLayout layout, String label, View.OnClickListener listener) {
        Button button = button(label, COLOR_INK, Color.WHITE, listener);
        button.setBackground(cardBackground(Color.WHITE, COLOR_LINE, 10));
        layout.addView(button, matchWidth(dp(9)));
        return button;
    }

    private Button addTextButton(LinearLayout layout, String label, View.OnClickListener listener) {
        Button button = button(label, COLOR_MUTED, Color.TRANSPARENT, listener);
        layout.addView(button, matchWidth(dp(8)));
        return button;
    }

    private Button button(String label, int textColor, int backgroundColor, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(15);
        button.setTextColor(textColor);
        button.setAllCaps(false);
        button.setMinHeight(dp(52));
        button.setGravity(Gravity.CENTER);
        button.setBackground(cardBackground(backgroundColor, backgroundColor, 10));
        if (listener != null) button.setOnClickListener(listener);
        return button;
    }

    private TextView text(String value, int size, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", style));
        view.setLineSpacing(0, 1.12f);
        return view;
    }

    private GradientDrawable cardBackground(int fill, int stroke, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radiusDp));
        if (stroke != fill && stroke != Color.TRANSPARENT) drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams matchWidth(int topMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.topMargin = topMargin;
        return params;
    }

    private LinearLayout.LayoutParams weighted() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
    }

    private boolean isAccessibilityServiceEnabled() {
        if (Settings.Secure.getInt(getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 0) != 1) return false;
        String enabledServices = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(enabledServices)) return false;
        String expected = getPackageName() + "/" + UberAccessibilityService.class.getName();
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabledServices);
        while (splitter.hasNext()) if (expected.equalsIgnoreCase(splitter.next())) return true;
        return false;
    }

    private boolean isNotificationListenerEnabled() {
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        if (TextUtils.isEmpty(enabled)) return false;
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        while (splitter.hasNext()) {
            ComponentName component = ComponentName.unflattenFromString(splitter.next());
            if (component != null && getPackageName().equals(component.getPackageName())) return true;
        }
        return false;
    }

    private boolean isIgnoringBatteryOptimizations() {
        PowerManager manager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return manager != null && manager.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void saveConfig() {
        SharedPreferences.Editor editor = BridgeConfig.prefs(this).edit();
        editor.putString(BridgeConfig.KEY_ENDPOINT, endpointInput.getText().toString().trim());
        editor.putString(BridgeConfig.KEY_TOKEN, tokenInput.getText().toString().trim());
        editor.putString(BridgeConfig.KEY_STORE_ID, storeIdInput.getText().toString().trim());
        editor.putString(BridgeConfig.KEY_DEVICE_NAME, deviceNameInput.getText().toString().trim());
        editor.apply();
    }

    private void openUberOrders() {
        Intent intent = getPackageManager().getLaunchIntentForPackage("com.uber.restaurants");
        if (intent == null) {
            Toast.makeText(this, "Uber Orders が見つかりません", Toast.LENGTH_SHORT).show();
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
    }

    private void openBatterySettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Exception error) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private boolean isXiaomi() {
        return "xiaomi".equalsIgnoreCase(Build.MANUFACTURER)
            || "redmi".equalsIgnoreCase(Build.BRAND)
            || "poco".equalsIgnoreCase(Build.BRAND);
    }

    private void openAutoStartSettings() {
        Intent intent = new Intent("miui.intent.action.OP_AUTO_START");
        intent.setData(Uri.parse("package:" + getPackageName()));
        try {
            startActivity(intent);
            Toast.makeText(this, "Foundr1 Bridge の自動起動を ON にしてください", Toast.LENGTH_LONG).show();
        } catch (Exception firstError) {
            try {
                Intent fallback = new Intent();
                fallback.setComponent(new ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                ));
                startActivity(fallback);
                Toast.makeText(this, "Foundr1 Bridge の自動起動を ON にしてください", Toast.LENGTH_LONG).show();
            } catch (Exception secondError) {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + getPackageName())));
            }
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4101);
    }

    private String formatTime(long value) {
        if (value <= 0) return "";
        return new SimpleDateFormat("HH:mm", Locale.JAPAN).format(new Date(value));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
