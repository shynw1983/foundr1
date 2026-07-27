package jp.foundr1.store.bridge;

import android.accessibilityservice.AccessibilityService;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Rect;
import android.os.Build;
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
    private boolean finishingRecovery = false;
    private boolean recoveryReceiverRegistered = false;
    private final Runnable recoveryRunnable = this::recoverNewOrder;
    private final BroadcastReceiver recoveryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (
                intent != null
                && UberRecoveryState.ACTION_RECOVERY_REQUESTED.equals(intent.getAction())
            ) {
                scheduleRecovery(250L);
            }
        }
    };
    private final Runnable uploadRunnable = () -> {
        String text = pendingText.trim();
        if (text.length() < 8) return;
        long now = System.currentTimeMillis();
        if (text.equals(lastUploadedText) && now - lastUploadedAt < 30000) {
            handler.postDelayed(this::scrollOrderDetailsForward, 700);
            return;
        }
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
        boolean containsDetails = containsOrderDetails(nodes);
        boolean containsOverview = containsOrderOverview(nodes);
        if (!containsDetails) {
            if (containsAutoAcceptBanner(nodes)) {
                UberRecoveryState.requestFromAutoAcceptBanner(this);
            }
            root.recycle();
            if (UberRecoveryState.isPending(this)) {
                scheduleRecovery(containsOverview ? 700L : 1200L);
            }
            return;
        }
        root.recycle();
        String orderKey = extractOrderKey(nodes);
        if (UberRecoveryState.isPending(this)) {
            UberRecoveryState.markDetailsOpened(this, extractOrderCode(orderKey));
            handler.removeCallbacks(recoveryRunnable);
        }
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

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        if (!recoveryReceiverRegistered) {
            IntentFilter filter = new IntentFilter(UberRecoveryState.ACTION_RECOVERY_REQUESTED);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(recoveryReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(recoveryReceiver, filter);
            }
            recoveryReceiverRegistered = true;
        }
        if (UberRecoveryState.isPending(this)) scheduleRecovery(250L);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(recoveryRunnable);
        handler.removeCallbacks(uploadRunnable);
        if (recoveryReceiverRegistered) {
            try {
                unregisterReceiver(recoveryReceiver);
            } catch (Exception ignored) {
            }
            recoveryReceiverRegistered = false;
        }
        super.onDestroy();
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

    private boolean containsOrderOverview(JSONArray nodes) {
        return containsNodeId(nodes, "/ub__ueo_orders_header_title");
    }

    private boolean containsAutoAcceptBanner(JSONArray nodes) {
        for (int index = 0; index < nodes.length(); index += 1) {
            JSONObject node = nodes.optJSONObject(index);
            if (node == null) continue;
            if (!node.optString("viewId").endsWith("/snackbar_text")) continue;
            String text = node.optString("text");
            if (text.contains("注文を自動で受け付けました") || text.contains("订单已自动接受")) {
                return true;
            }
        }
        return false;
    }

    private boolean containsNodeId(JSONArray nodes, String suffix) {
        for (int index = 0; index < nodes.length(); index += 1) {
            JSONObject node = nodes.optJSONObject(index);
            if (node != null && node.optString("viewId").endsWith(suffix)) return true;
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
        if (scrollSteps >= 12) {
            finishAutomaticRecovery();
            return;
        }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        AccessibilityNodeInfo scrollView = findLeftOrderScrollView(root);
        boolean scrolled = false;
        if (scrollView != null) {
            scrolled = scrollView.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
            scrollView.recycle();
        }
        root.recycle();
        if (scrolled) {
            scrollSteps += 1;
        } else {
            finishAutomaticRecovery();
        }
    }

    private void scheduleRecovery(long delayMs) {
        handler.removeCallbacks(recoveryRunnable);
        handler.postDelayed(recoveryRunnable, delayMs);
    }

    private void recoverNewOrder() {
        if (!UberRecoveryState.isPending(this)) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            scheduleRecovery(1500L);
            return;
        }
        String packageName = value(root.getPackageName());
        if (!looksLikeUber(packageName)) {
            root.recycle();
            UberRecoveryState.launchUber(this);
            scheduleRecovery(1500L);
            return;
        }
        if (hasViewId(root, "ub__ueo_order_details_header_title")) {
            String orderCode = findTextForViewId(root, "ub__ueo_order_details_header_title");
            root.recycle();
            UberRecoveryState.markDetailsOpened(this, extractOrderCode(orderCode));
            return;
        }
        if (hasViewId(root, "ub__ueo_orders_header_title")) {
            AccessibilityNodeInfo orderCard = findActiveOrderCard(root, false);
            root.recycle();
            if (orderCard != null) {
                UberRecoveryState.noteOrderCardFound(this);
                String orderCode = findOrderCode(orderCard);
                boolean clicked = orderCard.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                orderCard.recycle();
                if (clicked) {
                    uploadRecoveryStatus("order_card_clicked", orderCode);
                    scheduleRecovery(2500L);
                    return;
                }
            }
            if (UberRecoveryState.shouldStopAfterEmptyOverview(this)) {
                uploadRecoveryStatus("no_unread_card_found", "");
                return;
            }
            scheduleRecovery(1500L);
            return;
        }
        root.recycle();
        if (UberRecoveryState.mayNavigateBack(this)) {
            performGlobalAction(GLOBAL_ACTION_BACK);
            scheduleRecovery(1500L);
        }
    }

    private boolean hasViewId(AccessibilityNodeInfo node, String suffix) {
        if (node == null) return false;
        String viewId = value(node.getViewIdResourceName());
        if (viewId.endsWith("/" + suffix)) return true;
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            boolean match = hasViewId(child, suffix);
            child.recycle();
            if (match) return true;
        }
        return false;
    }

    private AccessibilityNodeInfo findActiveOrderCard(AccessibilityNodeInfo node, boolean insideActiveOrders) {
        if (node == null) return null;
        String viewId = value(node.getViewIdResourceName());
        boolean inside = insideActiveOrders || viewId.endsWith("/ub_ueo_active_order_land_container");
        if (inside && node.isClickable()) {
            String orderCode = findOrderCode(node);
            if (!orderCode.isEmpty() && !UberRecoveryState.wasHandled(this, orderCode)) {
                return AccessibilityNodeInfo.obtain(node);
            }
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findActiveOrderCard(child, inside);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private String findOrderCode(AccessibilityNodeInfo node) {
        if (node == null) return "";
        String viewId = value(node.getViewIdResourceName());
        String text = value(node.getText());
        if (viewId.endsWith("/ub__orders_item_subtitle_text")) {
            String code = extractOrderCode(text);
            if (!code.isEmpty()) return code;
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            String match = findOrderCode(child);
            child.recycle();
            if (!match.isEmpty()) return match;
        }
        return "";
    }

    private String findTextForViewId(AccessibilityNodeInfo node, String suffix) {
        if (node == null) return "";
        String viewId = value(node.getViewIdResourceName());
        if (viewId.endsWith("/" + suffix)) return value(node.getText());
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            String match = findTextForViewId(child, suffix);
            child.recycle();
            if (!match.isEmpty()) return match;
        }
        return "";
    }

    private String extractOrderCode(String value) {
        String normalized = value == null ? "" : value.toUpperCase();
        java.util.regex.Matcher matcher = java.util.regex.Pattern
            .compile("\\b([A-Z0-9]{5,12})\\b")
            .matcher(normalized);
        String candidate = "";
        while (matcher.find()) candidate = matcher.group(1);
        return candidate;
    }

    private void finishAutomaticRecovery() {
        if (finishingRecovery || !UberRecoveryState.wasOpenedAutomatically(this)) return;
        finishingRecovery = true;
        handler.postDelayed(() -> {
            boolean moreOrders = UberRecoveryState.finishCurrentOrder(this);
            performGlobalAction(GLOBAL_ACTION_BACK);
            finishingRecovery = false;
            if (moreOrders) scheduleRecovery(1800L);
        }, 1800L);
    }

    private void uploadRecoveryStatus(String stage, String orderCode) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("stage", stage);
            payload.put("orderCode", orderCode == null ? "" : orderCode);
            BridgeUploader.upload(this, "recovery", UBER_ORDERS_PACKAGE, payload);
        } catch (Exception ignored) {
        }
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
