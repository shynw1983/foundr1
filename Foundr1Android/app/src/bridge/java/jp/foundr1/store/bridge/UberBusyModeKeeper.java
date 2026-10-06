package jp.foundr1.store.bridge;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.List;

/** Opt-in recovery of the observed Japanese Uber busy-mode flow. No coordinate clicks. */
final class UberBusyModeKeeper {
    static final String ENABLED = "uber_keep_busy_thirty";
    private static final String TAG = "Foundr1UberBusy";
    private static final String PREFIX = "com.uber.restaurants:id/";
    private static final String HEADER = "ub__ueo_order_header_status_button";
    private static final String MENU = "ub__ueo_store_status_modal_sheet_header_title";
    private static final String PICKER = "ub__ueo_store_status_duration_header_title";
    static final long REFRESH_INTERVAL_MS = 55L * 60L * 1000L;
    private enum Stage { IDLE, RESET_MENU, WAIT_NORMAL, OPEN_MENU, OPEN_PICKER, SELECT_THIRTY, WAIT_BUSY, CLOSING }
    private final AccessibilityService service;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Stage stage = Stage.IDLE;
    private boolean running;
    private long startedAt, lastActionAt, deferUntil, retryAt, closingAt;
    private long nextRefreshAt;
    private boolean periodicRefresh;
    private String lastDiagnostic = "";
    private final Runnable eventTick = this::run;
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            UberBusyModeKeeper.this.run();
            if (running) handler.postDelayed(this, 2000L);
        }
    };

    UberBusyModeKeeper(AccessibilityService service) { this.service = service; }
    static boolean enabled(android.content.Context context) {
        return BridgeConfig.prefs(context).getBoolean(ENABLED, false)
            && BridgeConfig.supportsPlatform(context, BridgeConfig.PLATFORM_UBER_EATS);
    }
    void start() { running = true; handler.post(poll); }
    void stop() { running = false; handler.removeCallbacks(poll); handler.removeCallbacks(eventTick); stage = Stage.IDLE; }
    boolean isNavigating() { return enabled(service) && stage != Stage.IDLE; }

    void onEvent(AccessibilityEvent event) {
        if (!running || !BridgeConfig.UBER_ORDERS_PACKAGE.contentEquals(event.getPackageName() == null ? "" : event.getPackageName())) return;
        int type = event.getEventType();
        long now = SystemClock.uptimeMillis();
        if (type == AccessibilityEvent.TYPE_TOUCH_INTERACTION_START
            || type == AccessibilityEvent.TYPE_TOUCH_INTERACTION_END
            || type == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
            deferUntil = now + 1500L;
        } else if (stage == Stage.IDLE && (type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
            || type == AccessibilityEvent.TYPE_VIEW_CLICKED) && now - lastActionAt > 900L) {
            deferUntil = now + 1500L;
        }
        // Content events accelerate detection; the independent poll cannot be starved by them.
        handler.removeCallbacks(eventTick);
        handler.postDelayed(eventTick, 150L);
    }

    private void run() {
        if (!running) return;
        try {
            if (!enabled(service)) { stage = Stage.IDLE; nextRefreshAt = 0L; periodicRefresh = false; return; }
            if (nextRefreshAt == 0L) nextRefreshAt = SystemClock.elapsedRealtime() + REFRESH_INTERVAL_MS;
            inspect();
        } catch (RuntimeException error) {
            stage = Stage.IDLE;
            retryAt = SystemClock.uptimeMillis() + 30000L;
            BridgeCrashReporter.reportCaught(service, "uber_busy_mode", error);
        }
    }

    private void inspect() {
        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null) return;
        try {
            if (!BridgeConfig.UBER_ORDERS_PACKAGE.contentEquals(root.getPackageName() == null ? "" : root.getPackageName())) {
                stage = Stage.IDLE;
                return;
            }
            long now = SystemClock.uptimeMillis();
            if (stage == Stage.CLOSING) { closeOwnedPanel(root, now); return; }
            if (BridgeCommandState.current(service) != null || UberRecoveryState.isPending(service)) {
                if (stage != Stage.IDLE) abandon(root, "yield_to_order_work", now);
                return;
            }
            if (stage != Stage.IDLE && now - startedAt > (periodicRefresh ? 30000L : 15000L)) { abandon(root, "transition_timeout", now); return; }
            if (now < deferUntil || now - lastActionAt < 450L) return;
            String header = textById(root, HEADER);
            boolean menu = hasId(root, MENU), picker = hasId(root, PICKER);
            if (stage == Stage.IDLE) {
                // Never take ownership of an employee's already-open settings/dialog.
                if (menu || picker || now < retryAt || !isOverview(root)) return;
                boolean refreshDue = SystemClock.elapsedRealtime() >= nextRefreshAt;
                boolean resetBusy = refreshDue && header.startsWith("混雑中");
                if (!"営業中".equals(header) && !resetBusy) return;
                if (clickId(root, HEADER, header)) {
                    startedAt = now;
                    periodicRefresh = refreshDue;
                    stage = resetBusy ? Stage.RESET_MENU : Stage.OPEN_MENU;
                    diagnostic(resetBusy ? "periodic_refresh_open_status" : "normal_detected_open_status");
                }
            } else if (stage == Stage.RESET_MENU) {
                if (menu && header.startsWith("混雑中") && clickTitle(root, "営業中")) {
                    stage = Stage.WAIT_NORMAL;
                    diagnostic("periodic_refresh_choose_normal");
                }
            } else if (stage == Stage.WAIT_NORMAL) {
                // Do not infer success from our click: wait for Uber to show normal.
                if ("営業中".equals(header) && !picker) {
                    if (menu) clickId(root, "ub__ueo_store_status_modal_sheet_header_back_button", null);
                    else if (isOverview(root) && clickId(root, HEADER, "営業中")) {
                        stage = Stage.OPEN_MENU;
                        diagnostic("periodic_refresh_normal_confirmed");
                    }
                }
            } else if (stage == Stage.OPEN_MENU) {
                if (menu && "営業中".equals(header) && clickTitle(root, "混雑中")) {
                    stage = Stage.OPEN_PICKER;
                    diagnostic("choose_busy");
                }
            } else if (stage == Stage.OPEN_PICKER) {
                if (picker && clickTitle(root, "30分以上")) {
                    stage = Stage.SELECT_THIRTY;
                    diagnostic("select_thirty");
                }
            } else if (stage == Stage.SELECT_THIRTY) {
                // Enabled Save alone is insufficient: verify the exact selected 30-minute row.
                if (picker && selectedTitle(root, "30分以上")
                    && clickId(root, "ub__ueo_store_status_duration_button", "準備時間を更新する")) {
                    stage = Stage.WAIT_BUSY;
                    diagnostic("apply_thirty");
                }
            } else if (stage == Stage.WAIT_BUSY && !menu && !picker && header.startsWith("混雑中")) {
                Log.i(TAG, "busy_thirty_confirmed elapsedMs=" + (now - startedAt));
                stage = Stage.IDLE;
                retryAt = 0L;
                // Every confirmed busy update renews the session, including normal recovery.
                nextRefreshAt = SystemClock.elapsedRealtime() + REFRESH_INTERVAL_MS;
                periodicRefresh = false;
                lastDiagnostic = "";
            }
            if (stage != Stage.IDLE) {
                handler.removeCallbacks(eventTick);
                handler.postDelayed(eventTick, 500L);
            }
        } finally { root.recycle(); }
    }

    private void abandon(AccessibilityNodeInfo root, String reason, long now) {
        stage = Stage.CLOSING;
        closingAt = now;
        retryAt = now + 30000L;
        diagnostic(reason);
        closeOwnedPanel(root, now);
    }

    private void closeOwnedPanel(AccessibilityNodeInfo root, long now) {
        // Closing the duration picker can reveal the status menu. Observe and close
        // that second level before releasing order recovery; never send blind Backs.
        if (now - closingAt > 4000L) { stage = Stage.IDLE; return; }
        if (now - lastActionAt >= 450L) {
            if (hasId(root, PICKER)) clickId(root, "ub__ueo_store_status_duration_header_back_button", null);
            else if (hasId(root, MENU)) clickId(root, "ub__ueo_store_status_modal_sheet_header_back_button", null);
            else { stage = Stage.IDLE; return; }
        }
        handler.removeCallbacks(eventTick);
        handler.postDelayed(eventTick, 500L);
    }

    private static boolean isOverview(AccessibilityNodeInfo root) {
        return hasId(root, "ub__ueo_orders_header_title")
            && (hasId(root, "ub_ueo_active_order_land_container") || hasId(root, "ub__ueo_orders_tab_item_title"));
    }
    private static String compact(CharSequence text) { return text == null ? "" : text.toString().replaceAll("[\\s\\u00a0]+", "").trim(); }
    private static AccessibilityNodeInfo find(AccessibilityNodeInfo node, String id, String label) {
        if (!node.isVisibleToUser()) return null;
        // The platform indexes view IDs. Avoid hundreds of cross-process child reads
        // on every poll, especially on older tablets and behind modal sheets.
        List<AccessibilityNodeInfo> matches = node.findAccessibilityNodeInfosByViewId(PREFIX + id);
        AccessibilityNodeInfo result = null;
        int count = 0;
        for (AccessibilityNodeInfo match : matches) {
            if (match.isVisibleToUser() && (label == null || label.equals(compact(match.getText())))) {
                count++;
                if (result == null) result = AccessibilityNodeInfo.obtain(match);
            }
            match.recycle();
        }
        if (count > 1 && result != null) { result.recycle(); return null; }
        return result;
    }
    private static boolean hasId(AccessibilityNodeInfo root, String id) {
        AccessibilityNodeInfo node = find(root, id, null);
        if (node == null) return false;
        node.recycle(); return true;
    }
    private static String textById(AccessibilityNodeInfo root, String id) {
        AccessibilityNodeInfo node = find(root, id, null);
        if (node == null) return "";
        String value = compact(node.getText()); node.recycle(); return value;
    }
    private static boolean selectedTitle(AccessibilityNodeInfo root, String label) {
        AccessibilityNodeInfo node = find(root, "title_text", label);
        if (node == null) return false;
        boolean selected = node.isSelected();
        AccessibilityNodeInfo parent = node.getParent();
        if (parent != null) { selected |= parent.isChecked() || parent.isSelected(); parent.recycle(); }
        node.recycle(); return selected;
    }
    private boolean clickId(AccessibilityNodeInfo root, String id, String label) {
        AccessibilityNodeInfo node = find(root, id, label);
        if (node == null) return false;
        try {
            if (!node.refresh() || !node.isVisibleToUser() || !node.isEnabled() || !node.isClickable()
                || !PREFIX.concat(id).equals(node.getViewIdResourceName())
                || (label != null && !label.equals(compact(node.getText())))) return false;
            boolean clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            if (clicked) lastActionAt = SystemClock.uptimeMillis();
            return clicked;
        } finally { node.recycle(); }
    }
    private boolean clickTitle(AccessibilityNodeInfo root, String label) {
        AccessibilityNodeInfo node = find(root, "title_text", label);
        if (node == null) return false;
        try {
            if (!node.refresh() || !label.equals(compact(node.getText()))) return false;
            for (int depth = 0; depth < 4; depth++) {
                if (node.isClickable()) {
                    if (!node.refresh() || !node.isEnabled() || !node.isVisibleToUser()) return false;
                    AccessibilityNodeInfo proof = find(node, "title_text", label);
                    if (proof == null) return false;
                    proof.recycle();
                    boolean clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                    if (clicked) lastActionAt = SystemClock.uptimeMillis();
                    return clicked;
                }
                AccessibilityNodeInfo parent = node.getParent();
                if (parent == null) return false;
                node.recycle(); node = parent;
            }
            return false;
        } finally { node.recycle(); }
    }
    private void diagnostic(String value) {
        if (value.equals(lastDiagnostic)) return;
        lastDiagnostic = value;
        Log.i(TAG, value);
    }
}
