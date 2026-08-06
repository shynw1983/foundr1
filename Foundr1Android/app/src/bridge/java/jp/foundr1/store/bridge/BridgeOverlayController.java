package jp.foundr1.store.bridge;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/** A small, non-interactive status mark shown over supported delivery apps. */
final class BridgeOverlayController {
    private static final String TAG = "Foundr1BridgeOverlay";
    private static final int COLOR_SURFACE = Color.argb(224, 28, 31, 30);
    private static final int COLOR_HEALTHY = Color.rgb(62, 190, 126);
    private static final int COLOR_ATTENTION = Color.rgb(240, 179, 71);
    private static final int COLOR_ERROR = Color.rgb(244, 82, 104);

    private final AccessibilityService service;
    private final WindowManager windowManager;
    private LinearLayout pill;
    private TextView dot;
    private TextView label;
    private boolean attached = false;
    private boolean orderAppVisible = false;

    BridgeOverlayController(AccessibilityService service) {
        this.service = service;
        this.windowManager = (WindowManager) service.getSystemService(Context.WINDOW_SERVICE);
    }

    void setOrderAppVisible(boolean visible) {
        if (orderAppVisible == visible && attached == visible) {
            if (visible) updateHealth();
            return;
        }
        orderAppVisible = visible;
        if (visible) show();
        else hide();
    }

    void updateHealth() {
        if (!attached || dot == null || label == null) return;
        BridgeHealthState.Snapshot health = BridgeHealthState.snapshot(service);
        String level = BridgeStatusReporter.healthLevel(health);
        if ("healthy".equals(level)) {
            dot.setTextColor(COLOR_HEALTHY);
            label.setText("BRIDGE  正常");
        } else if ("attention".equals(level)) {
            dot.setTextColor(COLOR_ATTENTION);
            label.setText(health.pendingCount > 0 ? "BRIDGE  未送信 " + health.pendingCount : "BRIDGE  確認中");
        } else {
            dot.setTextColor(COLOR_ERROR);
            label.setText("BRIDGE  異常");
        }
    }

    void destroy() {
        orderAppVisible = false;
        hide();
    }

    private void show() {
        if (attached || windowManager == null) return;
        ensureView();
        try {
            windowManager.addView(pill, layoutParams());
            attached = true;
            updateHealth();
            Log.i(TAG, "Overlay attached");
        } catch (RuntimeException error) {
            attached = false;
            Log.w(TAG, "Unable to attach overlay", error);
        }
    }

    private void hide() {
        if (!attached || pill == null || windowManager == null) return;
        try {
            windowManager.removeViewImmediate(pill);
        } catch (RuntimeException ignored) {
        }
        attached = false;
        Log.i(TAG, "Overlay removed");
    }

    private void ensureView() {
        if (pill != null) return;
        pill = new LinearLayout(service);
        pill.setOrientation(LinearLayout.HORIZONTAL);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setPadding(dp(10), dp(5), dp(11), dp(5));
        GradientDrawable background = new GradientDrawable();
        background.setColor(COLOR_SURFACE);
        background.setCornerRadius(dp(16));
        background.setStroke(dp(1), Color.argb(56, 255, 255, 255));
        pill.setBackground(background);
        if (Build.VERSION.SDK_INT >= 21) pill.setElevation(dp(6));

        dot = new TextView(service);
        dot.setText("●");
        dot.setTextSize(10);
        dot.setGravity(Gravity.CENTER);
        pill.addView(dot, new LinearLayout.LayoutParams(dp(14), dp(22)));

        label = new TextView(service);
        label.setTextColor(Color.WHITE);
        label.setTextSize(11);
        label.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        label.setGravity(Gravity.CENTER_VERTICAL);
        label.setSingleLine(true);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            dp(22)
        );
        labelParams.leftMargin = dp(3);
        pill.addView(label, labelParams);
        pill.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
    }

    private WindowManager.LayoutParams layoutParams() {
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.x = 0;
        params.y = statusBarHeight() + dp(8);
        params.setTitle("Foundr1 Bridge status");
        return params;
    }

    private int statusBarHeight() {
        int resourceId = service.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return resourceId > 0 ? service.getResources().getDimensionPixelSize(resourceId) : dp(24);
    }

    private int dp(int value) {
        return Math.round(value * service.getResources().getDisplayMetrics().density);
    }
}
