package jp.foundr1.store.bridge;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public class UberAccessibilityService extends AccessibilityService {
    private static final String UBER_ORDERS_PACKAGE = "com.uber.restaurants";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String pendingPackageName = "";
    private String pendingText = "";
    private JSONArray pendingNodes = new JSONArray();
    private String activeOrderKey = "";
    private int scrollSteps = 0;
    private final Map<String, JSONObject> accumulatedNodes = new LinkedHashMap<>();
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
            payload.put("nodes", pendingNodes);
            BridgeUploader.upload(this, "accessibility_order", pendingPackageName, payload);
            handler.postDelayed(this::scrollOrderDetailsForward, 700);
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
        JSONArray nodes = new JSONArray();
        collectNodes(root, "0", builder, nodes, new HashSet<>());
        root.recycle();
        if (!containsOrderDetails(nodes)) return;
        String orderKey = extractOrderKey(nodes);
        if (!orderKey.isEmpty() && !orderKey.equals(activeOrderKey)) {
            activeOrderKey = orderKey;
            scrollSteps = 0;
            accumulatedNodes.clear();
            lastUploadedText = "";
        }
        mergeNodes(nodes);
        pendingPackageName = packageName;
        pendingText = builder.toString();
        pendingNodes = accumulatedNodeArray();
        handler.removeCallbacks(uploadRunnable);
        handler.postDelayed(uploadRunnable, 1800);
    }

    @Override
    public void onInterrupt() {
    }

    private void collectNodes(
        AccessibilityNodeInfo node,
        String path,
        StringBuilder builder,
        JSONArray nodes,
        Set<Integer> seen
    ) {
        if (node == null) return;
        int hash = System.identityHashCode(node);
        if (seen.contains(hash)) return;
        seen.add(hash);
        CharSequence text = node.getText();
        CharSequence description = node.getContentDescription();
        append(builder, text);
        append(builder, description);
        try {
            String viewId = value(node.getViewIdResourceName());
            String textValue = value(text);
            String descriptionValue = value(description);
            if (!viewId.isEmpty() || !textValue.isEmpty() || !descriptionValue.isEmpty()) {
                Rect bounds = new Rect();
                node.getBoundsInScreen(bounds);
                JSONObject item = new JSONObject();
                item.put("viewId", viewId);
                item.put("text", textValue);
                item.put("contentDescription", descriptionValue);
                item.put("className", value(node.getClassName()));
                item.put("path", path);
                item.put("bounds", bounds.flattenToString());
                nodes.put(item);
            }
        } catch (Exception ignored) {
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            collectNodes(child, path + "." + index, builder, nodes, seen);
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

    private String value(CharSequence value) {
        return value == null ? "" : value.toString().trim();
    }

    private boolean containsOrderDetails(JSONArray nodes) {
        for (int index = 0; index < nodes.length(); index += 1) {
            JSONObject node = nodes.optJSONObject(index);
            if (node == null) continue;
            String viewId = node.optString("viewId");
            if (viewId.endsWith("/ub__ueo_order_details_header_title")) return true;
        }
        return false;
    }

    private String extractOrderKey(JSONArray nodes) {
        for (int index = 0; index < nodes.length(); index += 1) {
            JSONObject node = nodes.optJSONObject(index);
            if (node == null) continue;
            String viewId = node.optString("viewId");
            if (viewId.endsWith("/ub__ueo_order_details_header_title")) {
                return node.optString("text").trim();
            }
        }
        return "";
    }

    private void mergeNodes(JSONArray nodes) {
        for (int index = 0; index < nodes.length(); index += 1) {
            JSONObject node = nodes.optJSONObject(index);
            if (node == null) continue;
            String signature = node.optString("viewId")
                + "\n" + node.optString("text")
                + "\n" + node.optString("contentDescription");
            accumulatedNodes.put(signature, node);
        }
    }

    private JSONArray accumulatedNodeArray() {
        JSONArray result = new JSONArray();
        for (JSONObject node : accumulatedNodes.values()) result.put(node);
        return result;
    }

    private void scrollOrderDetailsForward() {
        if (scrollSteps >= 12) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        AccessibilityNodeInfo scrollView = findLeftOrderScrollView(root);
        boolean scrolled = false;
        if (scrollView != null) {
            scrolled = scrollView.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
            scrollView.recycle();
        }
        root.recycle();
        if (scrolled) scrollSteps += 1;
    }

    private AccessibilityNodeInfo findLeftOrderScrollView(AccessibilityNodeInfo node) {
        if (node == null) return null;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        if (
            "android.widget.ScrollView".contentEquals(node.getClassName())
            && bounds.left < 200
            && bounds.right <= 1400
            && node.isScrollable()
        ) {
            return AccessibilityNodeInfo.obtain(node);
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findLeftOrderScrollView(child);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private boolean looksLikeUber(String packageName) {
        return UBER_ORDERS_PACKAGE.equals(packageName);
    }
}
