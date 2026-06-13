package jp.foundr1.store.bridge;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import jp.foundr1.store.R;

public class BridgeActivity extends Activity {
    private EditText endpointInput;
    private EditText tokenInput;
    private EditText storeIdInput;
    private EditText deviceNameInput;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildLayout();
        requestNotificationPermissionIfNeeded();
        startBridgeService();
    }

    private void buildLayout() {
        int padding = dp(18);
        ScrollView scrollView = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(padding, padding, padding, padding);
        scrollView.addView(layout);

        TextView title = new TextView(this);
        title.setText("Foundr1 Bridge");
        title.setTextSize(24);
        title.setPadding(0, 0, 0, dp(12));
        layout.addView(title);

        TextView help = new TextView(this);
        help.setText("Uber Eats の通知と画面文字を読み取り、Foundr1 OS に送信します。まず接続先を保存し、通知アクセスとユーザー補助を有効にしてください。");
        help.setTextSize(14);
        help.setPadding(0, 0, 0, dp(16));
        layout.addView(help);

        endpointInput = addInput(layout, "Endpoint URL", BridgeConfig.endpoint(this));
        tokenInput = addInput(layout, "Bridge token", BridgeConfig.token(this));
        storeIdInput = addInput(layout, "Store ID（任意）", BridgeConfig.storeId(this));
        deviceNameInput = addInput(layout, "Device name（任意）", BridgeConfig.deviceName(this));

        addButton(layout, "保存してサービス開始", view -> {
            saveConfig();
            startBridgeService();
            Toast.makeText(this, "保存しました。", Toast.LENGTH_SHORT).show();
        });
        addButton(layout, "テスト送信", view -> sendTestEvent());
        addButton(layout, "通知アクセスを開く", view -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        addButton(layout, "ユーザー補助設定を開く", view -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        addButton(layout, "電池最適化の除外を開く", view -> openBatterySettings());

        setContentView(scrollView);
    }

    private EditText addInput(LinearLayout layout, String label, String value) {
        TextView textView = new TextView(this);
        textView.setText(label);
        textView.setPadding(0, dp(10), 0, dp(4));
        layout.addView(textView);
        EditText editText = new EditText(this);
        editText.setText(value);
        editText.setSingleLine(false);
        editText.setMinLines(1);
        editText.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        layout.addView(editText);
        return editText;
    }

    private void addButton(LinearLayout layout, String label, android.view.View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.topMargin = dp(10);
        layout.addView(button, params);
    }

    private void saveConfig() {
        SharedPreferences.Editor editor = BridgeConfig.prefs(this).edit();
        editor.putString(BridgeConfig.KEY_ENDPOINT, endpointInput.getText().toString().trim());
        editor.putString(BridgeConfig.KEY_TOKEN, tokenInput.getText().toString().trim());
        editor.putString(BridgeConfig.KEY_STORE_ID, storeIdInput.getText().toString().trim());
        editor.putString(BridgeConfig.KEY_DEVICE_NAME, deviceNameInput.getText().toString().trim());
        editor.apply();
    }

    private void sendTestEvent() {
        saveConfig();
        try {
            JSONObject payload = new JSONObject();
            payload.put("message", "Foundr1 Bridge test event");
            BridgeUploader.upload(this, "test", "", payload);
            Toast.makeText(this, "テスト送信しました。", Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
        }
    }

    private void startBridgeService() {
        Intent intent = new Intent(this, BridgeForegroundService.class);
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
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

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4101);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
