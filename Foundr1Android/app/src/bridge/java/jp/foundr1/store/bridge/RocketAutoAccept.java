package jp.foundr1.store.bridge;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Opt-in, semantic ACTION_CLICK only. Never uses a screen coordinate fallback. */
final class RocketAutoAccept {
    static final String ENABLED = "rocket_auto_accept_plus_ten";
    private final AccessibilityService service;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = this::run;
    private boolean running;
    private String orderCode = "";
    private long startedAt;
    private boolean dialogOpenDispatched;
    private boolean acceptanceConfirmed;
    private boolean orderManagementOpened;
    private boolean acceptedOrderOpened;
    private int waitingForChange = -1;
    private long lastActionAt;
    private String lastDiagnostic = "";

    RocketAutoAccept(AccessibilityService service) { this.service = service; }

    void start() {
        if (running) return;
        running = true;
        handler.post(tick);
    }

    void stop() { running = false; handler.removeCallbacks(tick); }

    static boolean enabled(android.content.Context context) {
        return BridgeConfig.prefs(context).getBoolean(ENABLED, false)
            && BridgeConfig.supportsPlatform(context, BridgeConfig.PLATFORM_ROCKET_NOW);
    }

    private void run() {
        try {
            if (enabled(service) && BridgeCommandState.current(service) == null) inspect();
        } catch (RuntimeException error) {
            BridgeCrashReporter.reportCaught(service, "rocket_auto_accept", error);
        } finally {
            if (running) handler.postDelayed(tick, 700L);
        }
    }

    private void inspect() {
        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null) return;
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        try {
            if (!BridgeConfig.ROCKET_NOW_PACKAGE.contentEquals(root.getPackageName() == null ? "" : root.getPackageName())) return;
            collect(root, nodes);
            boolean dialog = has(nodes, "予想調理時間の変更");
            if (!dialog && !has(nodes, "新規注文")) {
                followAcceptedOrder(nodes);
                return;
            }
            long now = SystemClock.elapsedRealtime();
            SharedPreferences state = service.getSharedPreferences("rocket_auto_accept", 0);
            String visibleCode = code(nodes);
            if (!visibleCode.isEmpty() && !visibleCode.equals(orderCode)) {
                orderCode = visibleCode;
                startedAt = now;
                waitingForChange = -1;
                dialogOpenDispatched = false;
                acceptanceConfirmed = false;
                orderManagementOpened = false;
                acceptedOrderOpened = false;
            }
            // Do not associate an unidentified dialog with an old order indefinitely.
            if (orderCode.isEmpty() || now - startedAt > 90000L) {
                diagnostic("waiting_for_order_identity");
                return;
            }
            if (System.currentTimeMillis() - state.getLong("submitted_" + orderCode, 0L) < 86400000L) {
                diagnostic("accept_dispatched_awaiting_confirmation");
                return;
            }
            if (now - lastActionAt < 900L) return;
            if (!dialog) {
                if (!dialogOpenDispatched) {
                    dialogOpenDispatched = click(find(nodes, "調理時間変更"), "open_time_dialog");
                } else diagnostic("waiting_for_time_dialog");
                return;
            }
            // Flutter exposes the top dialog as one merged description. Restrict both
            // values and buttons to that dialog; stacked/underlying dialogs are stale.
            AccessibilityNodeInfo dialogRoot = null;
            for (AccessibilityNodeInfo node : nodes) {
                if (RocketAcceptPolicy.hasLine(label(node), "予想調理時間の変更")) {
                    dialogRoot = AccessibilityNodeInfo.obtain(node);
                    break;
                }
            }
            if (dialogRoot == null) return;
            for (AccessibilityNodeInfo node : nodes) node.recycle();
            nodes.clear();
            collect(dialogRoot, nodes);
            dialogRoot.recycle();
            int recommended = minutes(nodes, "推奨時間\\s*(\\d+)分");
            int current = minutes(nodes, "^(\\d+)分$");
            boolean atLimit = has(nodes, "調理時間は上限に達しています。");
            if (waitingForChange == current && !atLimit) {
                diagnostic("waiting_for_time_change");
                return; // Uncertain click result: never blindly add another five minutes.
            }
            waitingForChange = -1;
            AccessibilityNodeInfo five = find(nodes, "+5");
            AccessibilityNodeInfo one = find(nodes, "+1");
            RocketAcceptPolicy.Action action = RocketAcceptPolicy.decide(recommended, current,
                atLimit, five != null, one != null);
            if (action == RocketAcceptPolicy.Action.PLUS_FIVE || action == RocketAcceptPolicy.Action.PLUS_ONE) {
                if (click(action == RocketAcceptPolicy.Action.PLUS_FIVE ? five : one, "add_time")) {
                    waitingForChange = current;
                }
            } else if (action == RocketAcceptPolicy.Action.ACCEPT) {
                AccessibilityNodeInfo accept = find(nodes, "注文を受諾する");
                if (accept == null) { diagnostic("accept_button_unavailable"); return; }
                // Persist before dispatch so a restart cannot submit the same order twice.
                if (!state.edit().putLong("submitted_" + orderCode, System.currentTimeMillis()).commit()) return;
                if (!click(accept, "accept_dispatched")) {
                    state.edit().remove("submitted_" + orderCode).apply();
                }
            } else diagnostic("unrecognized_time_controls");
        } finally {
            for (AccessibilityNodeInfo node : nodes) node.recycle();
            root.recycle();
        }
    }

    private void followAcceptedOrder(List<AccessibilityNodeInfo> nodes) {
        if (orderCode.isEmpty()) return;
        long now = SystemClock.elapsedRealtime();
        if (now - startedAt > 90000L) { orderCode = ""; return; }
        long dispatchedAt = service.getSharedPreferences("rocket_auto_accept", 0)
            .getLong("submitted_" + orderCode, 0L);
        if (System.currentTimeMillis() - dispatchedAt >= 86400000L) return;
        for (AccessibilityNodeInfo node : nodes) {
            String compact = label(node).replaceAll("\\s+", "");
            if (compact.contains(orderCode + "注文受諾完了")
                || compact.contains(orderCode + "注文が承認されました。")) {
                acceptanceConfirmed = true;
                diagnostic("acceptance_confirmed_waiting_for_popup_close");
                return; // Rocket closes its confirmation in five seconds.
            }
        }
        boolean details = has(nodes, "メニュー") && has(nodes, "数量") && has(nodes, "金額");
        if (details && orderCode.equals(code(nodes))) {
            diagnostic("accepted_order_details_ready_for_upload");
            orderCode = "";
            return;
        }
        if (!acceptanceConfirmed || now - lastActionAt < 900L) return;
        // Only navigate after Rocket confirms this exact order. Never interact
        // with cancellation dialogs or another new order while following up.
        if (has(nodes, "キャンセル理由") || has(nodes, "確認")) return;
        for (AccessibilityNodeInfo node : nodes) {
            String value = label(node);
            if (RocketAcceptPolicy.hasLine(value, orderCode) && value.contains("[メニュー")) {
                if (!acceptedOrderOpened) acceptedOrderOpened = click(node, "open_accepted_order_details");
                return;
            }
        }
        if (!orderManagementOpened) {
            for (AccessibilityNodeInfo node : nodes) {
                String value = label(node);
                if (RocketAcceptPolicy.hasLine(value, "注文管理") && value.contains("タブ:")) {
                    orderManagementOpened = click(node, "open_order_management_after_accept");
                    return;
                }
            }
        }
    }

    private boolean click(AccessibilityNodeInfo node, String stage) {
        if (node == null) return false;
        // refresh() guards against a replaced Flutter node between inspection and dispatch.
        String before = label(node);
        if (!node.refresh() || !node.isVisibleToUser() || !node.isEnabled()
            || !node.isClickable() || !before.equals(label(node))) return false;
        lastActionAt = SystemClock.elapsedRealtime();
        boolean result = node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        diagnostic(stage + (result ? "" : "_failed"));
        return result;
    }

    private void diagnostic(String stage) {
        String next = orderCode + ":" + stage;
        if (!next.equals(lastDiagnostic)) Log.i("Foundr1RocketAccept", next);
        lastDiagnostic = next;
    }

    private static String label(AccessibilityNodeInfo node) {
        String text = node.getText() == null ? "" : node.getText().toString();
        String desc = node.getContentDescription() == null ? "" : node.getContentDescription().toString();
        return (text.isEmpty() ? desc : text).trim().replace('＋', '+');
    }

    private static void collect(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> nodes) {
        if (node.isVisibleToUser()) nodes.add(AccessibilityNodeInfo.obtain(node));
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            collect(child, nodes);
            child.recycle();
        }
    }

    private static boolean has(List<AccessibilityNodeInfo> nodes, String text) {
        for (AccessibilityNodeInfo node : nodes) if (RocketAcceptPolicy.hasLine(label(node), text)) return true;
        return false;
    }

    private static AccessibilityNodeInfo find(List<AccessibilityNodeInfo> nodes, String text) {
        for (AccessibilityNodeInfo node : nodes) {
            if (label(node).equals(text) && node.isClickable() && node.isEnabled()) return node;
        }
        return null;
    }

    private static int minutes(List<AccessibilityNodeInfo> nodes, String expression) {
        Pattern pattern = Pattern.compile(expression, Pattern.MULTILINE);
        int value = -1;
        for (AccessibilityNodeInfo node : nodes) {
            Matcher match = pattern.matcher(label(node));
            if (match.find()) {
                int candidate = Integer.parseInt(match.group(1));
                if (value != -1 && value != candidate) return -1;
                value = candidate;
            }
        }
        return value;
    }

    private static String code(List<AccessibilityNodeInfo> nodes) {
        String result = "";
        for (AccessibilityNodeInfo node : nodes) {
            String candidate = label(node);
            if (candidate.matches("[A-Z0-9]{6}") && candidate.matches(".*[A-Z].*") && candidate.matches(".*[0-9].*")) {
                if (!result.isEmpty() && !result.equals(candidate)) return "";
                result = candidate;
            }
        }
        return result;
    }
}
