package jp.foundr1.store.bridge;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class UberAccessibilityService extends AccessibilityService {
    private static final String TAG = "Foundr1BridgeRecovery";
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
    private BridgeOverlayController overlayController;
    private long recoveryScheduledAt = 0L;
    private String lastOrderClickAttemptCode = "";
    private long lastOrderClickAttemptAt = 0L;
    private long lastOverviewDiagnosticAt = 0L;
    private String pendingInventoryItemName = "";
    private String pendingInventoryInitialStatus = "";
    private long pendingInventoryClickedAt = 0L;
    private final Runnable inventoryCaptureRunnable = () -> runGuarded(
        "inventory_capture",
        this::capturePendingInventoryCurrentState
    );
    private String activeCommandId = "";
    private int commandAttempts = 0;
    private boolean commandReadyClickDispatched = false;
    private int commandInventoryTargetIndex = 0;
    private boolean commandInventoryStatusClickDispatched = false;
    private boolean commandInventoryChoiceClickDispatched = false;
    private boolean commandInventoryConfirmDispatched = false;
    private int commandInventorySearchTargetIndex = -1;
    private final Runnable commandRunnable = () -> runGuarded("command", this::processPendingCommand);
    private final Runnable commandPollRunnable = new Runnable() {
        @Override
        public void run() {
            runGuarded("command_poll", () -> BridgeCommandClient.poll(UberAccessibilityService.this));
            handler.postDelayed(this, 5 * 60 * 1000L);
        }
    };
    private final Runnable recoveryRunnable = () -> {
        recoveryScheduledAt = 0L;
        runGuarded("order_recovery", this::recoverNewOrder);
    };
    private final BroadcastReceiver recoveryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (
                intent != null
            ) {
                if (UberRecoveryState.ACTION_RECOVERY_REQUESTED.equals(intent.getAction())) {
                    scheduleRecovery(250L);
                } else if (BridgeCommandState.ACTION_COMMAND_AVAILABLE.equals(intent.getAction())) {
                    handler.removeCallbacks(commandRunnable);
                    handler.postDelayed(commandRunnable, 150L);
                } else if (BridgeHealthState.ACTION_CHANGED.equals(intent.getAction())) {
                    if (overlayController != null) overlayController.updateHealth();
                }
            }
        }
    };
    private final Runnable uploadRunnable = () -> {
        if (!UberRecoveryState.wasOpenedAutomatically(this)) return;
        String text = pendingText.trim();
        if (text.length() < 8) return;
        long now = System.currentTimeMillis();
        if (text.equals(lastUploadedText) && now - lastUploadedAt < 30000) {
            handler.postDelayed(
                () -> runGuarded("order_scroll", this::scrollOrderDetailsForward),
                700
            );
            return;
        }
        lastUploadedText = text;
        lastUploadedAt = now;
        try {
            JSONObject payload = new JSONObject();
            payload.put("screenText", text);
            payload.put("textLength", text.length());
            payload.put("nodes", pendingNodes);
            payload.put("orderCode", extractOrderCode(extractOrderKey(pendingNodes)));
            BridgeUploader.upload(this, "accessibility_order", pendingPackageName, payload);
            handler.postDelayed(
                () -> runGuarded("order_scroll", this::scrollOrderDetailsForward),
                700
            );
        } catch (Exception ignored) {
        }
    };

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        try {
            handleAccessibilityEvent(event);
        } catch (RuntimeException error) {
            BridgeCrashReporter.reportCaught(this, "accessibility_event", error);
            if (UberRecoveryState.isPending(this)) scheduleRecovery(1200L);
        }
    }

    private void handleAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) return;
        String packageName = event.getPackageName().toString();
        if (overlayController != null) {
            if (looksLikeUber(packageName)) {
                overlayController.setUberVisible(true);
            } else if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                boolean uberActive = false;
                AccessibilityNodeInfo activeRoot = getRootInActiveWindow();
                if (activeRoot != null) {
                    uberActive = looksLikeUber(value(activeRoot.getPackageName()));
                    activeRoot.recycle();
                }
                overlayController.setUberVisible(uberActive);
            }
        }
        if (!looksLikeUber(packageName)) return;
        trackInventoryStatusClick(event);
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        captureFocusedInventorySelection(packageName, root);
        StringBuilder builder = new StringBuilder();
        JSONArray nodes = new JSONArray();
        collectNodes(root, "0", builder, nodes, new HashSet<>());
        captureInventoryStateTransition(packageName, root);
        if (BridgeCommandState.current(this) != null) {
            handlePendingCommand(root, nodes);
            root.recycle();
            return;
        }
        boolean containsDetails = containsOrderDetails(nodes);
        boolean containsOverview = containsOrderOverview(nodes);
        if (!containsDetails) {
            if (containsAutoAcceptBanner(nodes)) {
                UberRecoveryState.requestFromAutoAcceptBanner(this);
            }
            if (containsOverview) ensureActiveOrderRecovery(root);
            root.recycle();
            if (containsOverview) {
                scheduleRecovery(UberRecoveryState.isPending(this) ? 700L : 1000L);
            } else if (UberRecoveryState.isPending(this)) {
                scheduleRecovery(1200L);
            }
            return;
        }
        root.recycle();
        if (!containsActiveOrderAction(nodes)) {
            if (UberRecoveryState.isPending(this)) scheduleRecovery(250L);
            return;
        }
        String orderCode = extractOrderCode(extractOrderKey(nodes));
        if (!UberRecoveryState.isPending(this)) {
            if (UberRecoveryState.wasHandled(this, orderCode)) return;
            UberRecoveryState.requestFromActiveOrderDetails(this, orderCode);
        }
        captureOrderDetails(packageName, builder, nodes);
    }

    private void runGuarded(String stage, Runnable operation) {
        try {
            operation.run();
        } catch (RuntimeException error) {
            BridgeCrashReporter.reportCaught(this, stage, error);
            if (UberRecoveryState.isPending(this)) scheduleRecovery(1200L);
        }
    }

    private void trackInventoryStatusClick(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_VIEW_CLICKED) return;
        AccessibilityNodeInfo source = event.getSource();
        if (source == null) return;
        String status = inventoryStatus(value(source.getContentDescription()));
        if (status.isEmpty()) status = inventoryStatus(value(source.getText()));
        if (status.isEmpty()) status = inventoryStatusInText(
            value(source.getContentDescription()) + "\n" + value(source.getText())
        );
        if (status.isEmpty()) status = findInventoryStatusInAncestors(source);
        if (status.isEmpty()) {
            Log.i(TAG, "Inventory click ignored: no status near " + value(source.getClassName()));
            source.recycle();
            return;
        }
        String itemName = findInventoryItemName(source);
        Log.i(
            TAG,
            "Inventory click status=" + status + ", item="
                + (itemName.length() > 120 ? itemName.substring(0, 120) : itemName)
        );
        source.recycle();
        if (itemName.isEmpty()) return;
        pendingInventoryItemName = itemName;
        pendingInventoryInitialStatus = status;
        pendingInventoryClickedAt = System.currentTimeMillis();
        handler.removeCallbacks(inventoryCaptureRunnable);
        handler.postDelayed(inventoryCaptureRunnable, 900L);
    }

    private String findInventoryStatusInAncestors(AccessibilityNodeInfo source) {
        AccessibilityNodeInfo cursor = AccessibilityNodeInfo.obtain(source);
        for (int depth = 0; depth < 5 && cursor != null; depth += 1) {
            String status = findInventoryStatus(cursor);
            if (status.isEmpty()) {
                status = inventoryStatusInText(
                    value(cursor.getContentDescription()) + "\n" + value(cursor.getText())
                );
            }
            AccessibilityNodeInfo parent = status.isEmpty() ? cursor.getParent() : null;
            cursor.recycle();
            cursor = parent;
            if (!status.isEmpty()) {
                if (cursor != null) cursor.recycle();
                return status;
            }
        }
        if (cursor != null) cursor.recycle();
        return "";
    }

    private void captureInventoryStateTransition(String packageName, AccessibilityNodeInfo root) {
        captureInventoryState(packageName, root, false);
    }

    private void capturePendingInventoryCurrentState() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || !looksLikeUber(value(root.getPackageName()))) {
            if (root != null) root.recycle();
            return;
        }
        captureInventoryState(UBER_ORDERS_PACKAGE, root, true);
        root.recycle();
    }

    private void captureInventoryState(
        String packageName,
        AccessibilityNodeInfo root,
        boolean uploadCurrentState
    ) {
        if (
            pendingInventoryItemName.isEmpty()
            || System.currentTimeMillis() - pendingInventoryClickedAt > 5 * 60 * 1000L
        ) return;
        List<AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText(
            pendingInventoryItemName
        );
        String nextStatus = "";
        for (AccessibilityNodeInfo match : matches) {
            AccessibilityNodeInfo cursor = AccessibilityNodeInfo.obtain(match);
            for (int depth = 0; depth < 5 && cursor != null; depth += 1) {
                nextStatus = findInventoryStatus(cursor);
                AccessibilityNodeInfo parent = nextStatus.isEmpty() ? cursor.getParent() : null;
                cursor.recycle();
                cursor = parent;
                if (!nextStatus.isEmpty()) break;
            }
            match.recycle();
            if (!nextStatus.isEmpty()) break;
        }
        if (
            nextStatus.isEmpty()
            || (!uploadCurrentState && nextStatus.equals(pendingInventoryInitialStatus))
        ) return;
        uploadInventoryState(packageName, pendingInventoryItemName, nextStatus);
        clearPendingInventoryCapture();
    }

    private void captureFocusedInventorySelection(
        String packageName,
        AccessibilityNodeInfo node
    ) {
        if (node == null) return;
        if (node.isFocused() || node.isSelected()) {
            String status = findInventoryStatus(node);
            if (status.isEmpty()) {
                status = inventoryStatusInText(
                    value(node.getContentDescription()) + "\n" + value(node.getText())
                );
            }
            if (!status.isEmpty()) {
                String itemName = findInventoryItemName(node);
                if (!itemName.isEmpty()) {
                    uploadInventoryState(packageName, itemName, status);
                    return;
                }
            }
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            captureFocusedInventorySelection(packageName, child);
            child.recycle();
        }
    }

    private void uploadInventoryState(String packageName, String itemName, String status) {
        try {
            boolean isAvailable = "available".equals(status);
            if (!BridgeInventoryState.shouldUpload(this, itemName, status)) return;
            JSONObject payload = new JSONObject();
            payload.put("itemName", itemName);
            payload.put("isAvailable", isAvailable);
            payload.put(
                "signalText",
                itemName + (isAvailable ? " 在庫あり" : " 売り切れ")
            );
            BridgeUploader.upload(this, "accessibility_inventory", packageName, payload);
        } catch (Exception ignored) {
        }
    }

    private void clearPendingInventoryCapture() {
        pendingInventoryItemName = "";
        pendingInventoryInitialStatus = "";
        pendingInventoryClickedAt = 0L;
    }

    private String findInventoryItemName(AccessibilityNodeInfo source) {
        AccessibilityNodeInfo cursor = AccessibilityNodeInfo.obtain(source);
        String best = "";
        for (int depth = 0; depth < 5 && cursor != null; depth += 1) {
            String candidate = longestInventoryLabel(cursor);
            if (candidate.length() > best.length()) best = candidate;
            Rect bounds = new Rect();
            cursor.getBoundsInScreen(bounds);
            AccessibilityNodeInfo parent = cursor.getParent();
            cursor.recycle();
            cursor = parent;
            if (!best.isEmpty() && bounds.height() >= 80 && bounds.height() <= 300) break;
        }
        if (cursor != null) cursor.recycle();
        return best;
    }

    private String longestInventoryLabel(AccessibilityNodeInfo node) {
        if (node == null) return "";
        String best = inventoryLabel(value(node.getText()));
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            String candidate = longestInventoryLabel(child);
            child.recycle();
            if (candidate.length() > best.length()) best = candidate;
        }
        return best;
    }

    private String inventoryLabel(String value) {
        String text = value == null ? "" : value.trim();
        if (
            text.length() < 2
            || !inventoryStatusInText(text).isEmpty()
            || text.matches("\\d+\\s*カスタマイズ.*")
            || text.matches("\\d+")
        ) return "";
        return text;
    }

    private String findInventoryStatus(AccessibilityNodeInfo node) {
        if (node == null) return "";
        String status = inventoryStatus(value(node.getContentDescription()));
        if (status.isEmpty()) status = inventoryStatus(value(node.getText()));
        if (!status.isEmpty()) return status;
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            String match = findInventoryStatus(child);
            child.recycle();
            if (!match.isEmpty()) return match;
        }
        return "";
    }

    private String inventoryStatus(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase();
        if (
            "在庫あり".equals(normalized)
            || "available".equals(normalized)
            || "有货".equals(normalized)
            || "有貨".equals(normalized)
        ) return "available";
        if (
            "売り切れ".equals(normalized)
            || "out of stock".equals(normalized)
            || "售罄".equals(normalized)
            || "缺货".equals(normalized)
            || "缺貨".equals(normalized)
        ) return "sold_out";
        return "";
    }

    private String inventoryStatusInText(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase();
        if (
            normalized.contains("在庫あり")
            || normalized.contains("available")
            || normalized.contains("有货")
            || normalized.contains("有貨")
        ) return "available";
        if (
            normalized.contains("売り切れ")
            || normalized.contains("out of stock")
            || normalized.contains("售罄")
            || normalized.contains("缺货")
            || normalized.contains("缺貨")
        ) return "sold_out";
        return "";
    }

    private void captureOrderDetails(String packageName, StringBuilder builder, JSONArray nodes) {
        String orderKey = extractOrderKey(nodes);
        lastOrderClickAttemptCode = "";
        lastOrderClickAttemptAt = 0L;
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
        BridgeHealthState.setAccessibilityConnected(this, true);
        BridgeServiceStarter.ensureStarted(this, "accessibility_connected");
        overlayController = new BridgeOverlayController(this);
        AccessibilityNodeInfo activeRoot = getRootInActiveWindow();
        if (activeRoot != null) {
            overlayController.setUberVisible(looksLikeUber(value(activeRoot.getPackageName())));
            activeRoot.recycle();
        }
        if (!recoveryReceiverRegistered) {
            IntentFilter filter = new IntentFilter();
            filter.addAction(UberRecoveryState.ACTION_RECOVERY_REQUESTED);
            filter.addAction(BridgeCommandState.ACTION_COMMAND_AVAILABLE);
            filter.addAction(BridgeHealthState.ACTION_CHANGED);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(recoveryReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(recoveryReceiver, filter);
            }
            recoveryReceiverRegistered = true;
        }
        if (BridgeCommandState.current(this) != null) handler.postDelayed(commandRunnable, 150L);
        handler.removeCallbacks(commandPollRunnable);
        handler.post(commandPollRunnable);
        if (UberRecoveryState.isPending(this)) scheduleRecovery(250L);
    }

    @Override
    public void onDestroy() {
        BridgeHealthState.setAccessibilityConnected(this, false);
        if (overlayController != null) {
            overlayController.destroy();
            overlayController = null;
        }
        handler.removeCallbacks(recoveryRunnable);
        recoveryScheduledAt = 0L;
        handler.removeCallbacks(uploadRunnable);
        handler.removeCallbacks(commandRunnable);
        handler.removeCallbacks(commandPollRunnable);
        handler.removeCallbacks(inventoryCaptureRunnable);
        if (recoveryReceiverRegistered) {
            try {
                unregisterReceiver(recoveryReceiver);
            } catch (Exception ignored) {
            }
            recoveryReceiverRegistered = false;
        }
        super.onDestroy();
    }

    private void processPendingCommand() {
        JSONObject command = BridgeCommandState.current(this);
        if (command == null) return;
        String commandId = command.optString("id");
        if (!commandId.equals(activeCommandId)) {
            activeCommandId = commandId;
            commandAttempts = 0;
            commandReadyClickDispatched = false;
            commandInventoryTargetIndex = 0;
            commandInventoryStatusClickDispatched = false;
            commandInventoryChoiceClickDispatched = false;
            commandInventoryConfirmDispatched = false;
            commandInventorySearchTargetIndex = -1;
        }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || !looksLikeUber(value(root.getPackageName()))) {
            if (root != null) root.recycle();
            UberRecoveryState.launchUber(this);
            retryPendingCommand(1400L, "Uber Orders を開けませんでした。");
            return;
        }
        JSONArray nodes = new JSONArray();
        collectNodes(root, "0", new StringBuilder(), nodes, new HashSet<>());
        handlePendingCommand(root, nodes);
        root.recycle();
    }

    private void handlePendingCommand(AccessibilityNodeInfo root, JSONArray nodes) {
        JSONObject command = BridgeCommandState.current(this);
        if (command == null) return;
        String commandType = command.optString("type");
        if ("set_inventory_availability".equals(commandType)) {
            handleInventoryCommand(root, command);
            return;
        }
        if (!"mark_order_ready".equals(commandType)) {
            BridgeCommandState.fail(this, "Unsupported command: " + command.optString("type"));
            resetCommandAttempt();
            return;
        }
        String targetCode = extractOrderCode(
            command.optJSONObject("payload") == null
                ? ""
                : command.optJSONObject("payload").optString("orderCode")
        );
        if (targetCode.isEmpty()) {
            BridgeCommandState.fail(this, "注文番号がありません。");
            resetCommandAttempt();
            return;
        }

        if (containsOrderDetails(nodes)) {
            String visibleCode = extractOrderCode(extractOrderKey(nodes));
            if (!targetCode.equals(visibleCode)) {
                performGlobalAction(GLOBAL_ACTION_BACK);
                retryPendingCommand(1000L, "対象注文を開けませんでした。");
                return;
            }
            AccessibilityNodeInfo action = findReadyAction(root);
            if (action == null) {
                if (commandReadyClickDispatched) {
                    BridgeCommandState.complete(this, "ready_confirmed");
                    resetCommandAttempt();
                    return;
                }
                retryPendingCommand(1200L, "Uber の「準備完了」ボタンが見つかりません。");
                return;
            }
            boolean clicked = clickOrderCard(action);
            action.recycle();
            if (clicked) {
                commandReadyClickDispatched = true;
                retryPendingCommand(1200L, "Uber の「準備完了」操作を確認できませんでした。");
            } else {
                retryPendingCommand(1000L, "Uber の「準備完了」ボタンを押せませんでした。");
            }
            return;
        }

        if (containsOrderOverview(nodes)) {
            AccessibilityNodeInfo activeCard = findActiveOrderCardByCode(root, targetCode, false);
            if (activeCard != null) {
                if (commandReadyClickDispatched) {
                    activeCard.recycle();
                    retryPendingCommand(1200L, "Uber 側の準備完了を確認できませんでした。");
                    return;
                }
                boolean clicked = clickOrderCard(activeCard);
                activeCard.recycle();
                if (clicked) {
                    retryPendingCommand(1400L, "対象注文の詳細を開けませんでした。");
                } else {
                    retryPendingCommand(900L, "対象注文を押せませんでした。");
                }
                return;
            }
            if (treeContainsOrderCode(root, targetCode)) {
                BridgeCommandState.complete(this, "already_ready");
                resetCommandAttempt();
                return;
            }
            retryPendingCommand(1200L, "準備中の対象注文が見つかりません。");
            return;
        }

        performGlobalAction(GLOBAL_ACTION_BACK);
        retryPendingCommand(1200L, "Uber の注文一覧へ戻れませんでした。");
    }

    private void retryPendingCommand(long delayMs, String finalError) {
        commandAttempts += 1;
        handler.removeCallbacks(commandRunnable);
        JSONObject command = BridgeCommandState.current(this);
        int maximumAttempts = command != null
            && "set_inventory_availability".equals(command.optString("type"))
                ? 45
                : 15;
        if (commandAttempts >= maximumAttempts) {
            BridgeCommandState.fail(this, finalError);
            resetCommandAttempt();
            return;
        }
        handler.postDelayed(commandRunnable, delayMs);
    }

    private void resetCommandAttempt() {
        activeCommandId = "";
        commandAttempts = 0;
        commandReadyClickDispatched = false;
        commandInventoryTargetIndex = 0;
        commandInventoryStatusClickDispatched = false;
        commandInventoryChoiceClickDispatched = false;
        commandInventoryConfirmDispatched = false;
        commandInventorySearchTargetIndex = -1;
        handler.removeCallbacks(commandRunnable);
    }

    private void handleInventoryCommand(AccessibilityNodeInfo root, JSONObject command) {
        JSONObject payload = command.optJSONObject("payload");
        JSONArray targets = payload == null ? null : payload.optJSONArray("targets");
        if (targets == null || targets.length() == 0) {
            BridgeCommandState.fail(this, "在庫連動の対象がありません。");
            resetCommandAttempt();
            return;
        }
        if (commandInventoryTargetIndex >= targets.length()) {
            BridgeCommandState.complete(this, "inventory_updated");
            resetCommandAttempt();
            return;
        }
        JSONObject target = targets.optJSONObject(commandInventoryTargetIndex);
        if (target == null) {
            advanceInventoryTarget();
            return;
        }
        boolean makeAvailable = payload.optBoolean("isAvailable", false);
        String desiredStatus = makeAvailable ? "available" : "sold_out";
        JSONArray aliases = target.optJSONArray("aliases");

        AccessibilityNodeInfo dialog = findNodeByClass(root, "android.app.AlertDialog");
        if (dialog != null && commandInventoryStatusClickDispatched) {
            String soldOutMode = payload.optString("soldOutMode", "indefinite");
            String choiceLabel = makeAvailable
                ? "在庫あり"
                : ("today".equals(soldOutMode) ? "本日売り切れ" : "再販予定なし");
            if (!commandInventoryChoiceClickDispatched) {
                AccessibilityNodeInfo choice = findChoiceByLabel(dialog, choiceLabel);
                boolean clicked = choice != null && clickOrderCard(choice);
                if (choice != null) choice.recycle();
                dialog.recycle();
                if (clicked) {
                    commandInventoryChoiceClickDispatched = true;
                    retryPendingCommand(450L, "Uber の在庫期間を選択できませんでした。");
                } else {
                    retryPendingCommand(600L, "Uber の在庫期間が見つかりませんでした。");
                }
                return;
            }
            if (!commandInventoryConfirmDispatched) {
                AccessibilityNodeInfo confirm = findActionByLabels(dialog, new String[] { "確定", "Confirm" });
                boolean clicked = confirm != null && clickOrderCard(confirm);
                if (confirm != null) confirm.recycle();
                dialog.recycle();
                if (clicked) {
                    commandInventoryConfirmDispatched = true;
                    retryPendingCommand(1100L, "Uber の在庫変更を確定できませんでした。");
                } else {
                    retryPendingCommand(600L, "Uber の確定ボタンが見つかりませんでした。");
                }
                return;
            }
            dialog.recycle();
            retryPendingCommand(700L, "Uber の在庫変更画面を閉じられませんでした。");
            return;
        }

        AccessibilityNodeInfo labelNode = findInventoryTargetNode(root, target.optString("label"), aliases);
        if (labelNode != null) {
            AccessibilityNodeInfo row = findInventoryRow(labelNode);
            labelNode.recycle();
            if (row != null) {
                String currentStatus = findInventoryStatus(row);
                if (desiredStatus.equals(currentStatus)) {
                    row.recycle();
                    advanceInventoryTarget();
                    return;
                }
                if (!currentStatus.isEmpty() && !commandInventoryStatusClickDispatched) {
                    AccessibilityNodeInfo statusAction = findInventoryStatusAction(row, currentStatus);
                    boolean clicked = statusAction != null && clickOrderCard(statusAction);
                    if (statusAction != null) statusAction.recycle();
                    row.recycle();
                    if (clicked) {
                        commandInventoryStatusClickDispatched = true;
                        retryPendingCommand(900L, "Uber の在庫状態を変更できませんでした。");
                    } else {
                        retryPendingCommand(800L, "Uber の在庫ボタンを押せませんでした。");
                    }
                    return;
                }
                row.recycle();
            }
        }

        if (
            isInventoryScreen(root)
            && commandInventorySearchTargetIndex != commandInventoryTargetIndex
        ) {
            AccessibilityNodeInfo search = findNodeByClass(root, "android.widget.EditText");
            String searchText = inventorySearchText(target.optString("label"), aliases);
            if (search != null && !searchText.isEmpty()) {
                Bundle arguments = new Bundle();
                arguments.putCharSequence(
                    AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                    searchText
                );
                boolean changed = search.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
                search.recycle();
                if (changed) {
                    commandInventorySearchTargetIndex = commandInventoryTargetIndex;
                    retryPendingCommand(900L, "Uber の対象商品を検索できませんでした。");
                    return;
                }
            } else if (search != null) {
                search.recycle();
            }
        }

        AccessibilityNodeInfo menuAction = findActionByLabels(
            root,
            new String[] { "メニュー", "商品", "在庫管理", "Menu", "Items" }
        );
        if (menuAction != null) {
            boolean clicked = clickOrderCard(menuAction);
            menuAction.recycle();
            if (clicked) {
                retryPendingCommand(1200L, "Uber の商品管理を開けませんでした。");
                return;
            }
        }
        AccessibilityNodeInfo drawerButton = findNodeByViewIdSuffix(
            root,
            "/ub__ueo_orders_header_menu_button"
        );
        if (drawerButton != null) {
            boolean clicked = clickOrderCard(drawerButton);
            drawerButton.recycle();
            if (clicked) {
                retryPendingCommand(550L, "Uber のメニューを開けませんでした。");
                return;
            }
        }
        if (scrollInventoryForward(root)) {
            retryPendingCommand(650L, "Uber の対象商品が見つかりませんでした。");
            return;
        }
        performGlobalAction(GLOBAL_ACTION_BACK);
        retryPendingCommand(1000L, "Uber の対象商品が見つかりませんでした。");
    }

    private void advanceInventoryTarget() {
        commandInventoryTargetIndex += 1;
        commandAttempts = 0;
        commandInventoryStatusClickDispatched = false;
        commandInventoryChoiceClickDispatched = false;
        commandInventoryConfirmDispatched = false;
        commandInventorySearchTargetIndex = -1;
        handler.removeCallbacks(commandRunnable);
        handler.postDelayed(commandRunnable, 250L);
    }

    private AccessibilityNodeInfo findInventoryTargetNode(
        AccessibilityNodeInfo root,
        String primaryLabel,
        JSONArray aliases
    ) {
        LinkedHashMap<String, Boolean> candidates = new LinkedHashMap<>();
        if (primaryLabel != null && !primaryLabel.trim().isEmpty()) candidates.put(primaryLabel.trim(), true);
        if (aliases != null) {
            for (int index = 0; index < aliases.length(); index += 1) {
                String alias = aliases.optString(index).trim();
                if (!alias.isEmpty()) candidates.put(alias, true);
            }
        }
        for (String candidate : candidates.keySet()) {
            List<AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText(candidate);
            AccessibilityNodeInfo selected = null;
            for (AccessibilityNodeInfo match : matches) {
                if (selected == null && match.isVisibleToUser()) selected = AccessibilityNodeInfo.obtain(match);
                match.recycle();
            }
            if (selected != null) return selected;
        }
        return null;
    }

    private boolean isInventoryScreen(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText("商品の提供状況");
        boolean found = !matches.isEmpty();
        for (AccessibilityNodeInfo match : matches) match.recycle();
        return found;
    }

    private String inventorySearchText(String primaryLabel, JSONArray aliases) {
        String value = primaryLabel == null ? "" : primaryLabel;
        if (value.isEmpty() && aliases != null && aliases.length() > 0) value = aliases.optString(0);
        String firstLanguage = value.split("[｜|]", 2)[0];
        return firstLanguage
            .replaceAll("【[^】]*】", "")
            .replaceAll("に変更$", "")
            .replaceAll("追加$", "")
            .replaceAll("[\\p{So}\\p{Sk}]", "")
            .trim();
    }

    private AccessibilityNodeInfo findNodeByClass(AccessibilityNodeInfo node, String className) {
        if (node == null) return null;
        if (className.equals(value(node.getClassName()))) return AccessibilityNodeInfo.obtain(node);
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findNodeByClass(child, className);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private AccessibilityNodeInfo findNodeByViewIdSuffix(AccessibilityNodeInfo node, String suffix) {
        if (node == null) return null;
        if (value(node.getViewIdResourceName()).endsWith(suffix) && node.isEnabled()) {
            return AccessibilityNodeInfo.obtain(node);
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findNodeByViewIdSuffix(child, suffix);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private AccessibilityNodeInfo findChoiceByLabel(AccessibilityNodeInfo node, String label) {
        if (node == null) return null;
        if (label.equals(value(node.getText()).trim()) || label.equals(value(node.getContentDescription()).trim())) {
            AccessibilityNodeInfo parent = node.getParent();
            if (parent != null) {
                AccessibilityNodeInfo clickable = findFirstClickable(parent);
                parent.recycle();
                if (clickable != null) return clickable;
            }
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findChoiceByLabel(child, label);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private AccessibilityNodeInfo findFirstClickable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isClickable() && node.isEnabled()) return AccessibilityNodeInfo.obtain(node);
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findFirstClickable(child);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private AccessibilityNodeInfo findInventoryRow(AccessibilityNodeInfo labelNode) {
        AccessibilityNodeInfo cursor = AccessibilityNodeInfo.obtain(labelNode);
        for (int depth = 0; depth < 6 && cursor != null; depth += 1) {
            if (!findInventoryStatus(cursor).isEmpty()) return cursor;
            AccessibilityNodeInfo parent = cursor.getParent();
            cursor.recycle();
            cursor = parent;
        }
        if (cursor != null) cursor.recycle();
        return null;
    }

    private AccessibilityNodeInfo findInventoryStatusAction(AccessibilityNodeInfo node, String status) {
        if (node == null) return null;
        String ownStatus = inventoryStatus(value(node.getContentDescription()));
        if (ownStatus.isEmpty()) ownStatus = inventoryStatus(value(node.getText()));
        if (status.equals(ownStatus) && node.isEnabled()) {
            AccessibilityNodeInfo clickable = clickableAncestor(node, 4);
            if (clickable != null) return clickable;
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findInventoryStatusAction(child, status);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private AccessibilityNodeInfo findActionByLabels(AccessibilityNodeInfo node, String[] labels) {
        if (node == null) return null;
        String text = value(node.getText()).trim();
        String description = value(node.getContentDescription()).trim();
        for (String label : labels) {
            if (label.equalsIgnoreCase(text) || label.equalsIgnoreCase(description)) {
                AccessibilityNodeInfo clickable = clickableAncestor(node, 3);
                if (clickable != null) return clickable;
            }
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findActionByLabels(child, labels);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private AccessibilityNodeInfo clickableAncestor(AccessibilityNodeInfo node, int maximumDepth) {
        AccessibilityNodeInfo cursor = AccessibilityNodeInfo.obtain(node);
        for (int depth = 0; depth <= maximumDepth && cursor != null; depth += 1) {
            if (cursor.isClickable() && cursor.isEnabled()) return cursor;
            AccessibilityNodeInfo parent = cursor.getParent();
            cursor.recycle();
            cursor = parent;
        }
        if (cursor != null) cursor.recycle();
        return null;
    }

    private boolean scrollInventoryForward(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (node.isScrollable() && node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) return true;
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            boolean scrolled = scrollInventoryForward(child);
            child.recycle();
            if (scrolled) return true;
        }
        return false;
    }

    private AccessibilityNodeInfo findReadyAction(AccessibilityNodeInfo node) {
        if (node == null) return null;
        String viewId = value(node.getViewIdResourceName());
        String label = value(node.getText()) + "\n" + value(node.getContentDescription());
        if (
            viewId.endsWith("/ub__order_details_action_secondary_button")
            && node.isEnabled()
            && isReadyActionText(label)
        ) return AccessibilityNodeInfo.obtain(node);
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findReadyAction(child);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private boolean isReadyActionText(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase();
        return normalized.contains("準備完了")
            || normalized.contains("准备完成")
            || normalized.contains("準備完成")
            || normalized.contains("准备好")
            || normalized.contains("mark ready")
            || normalized.contains("ready for pickup")
            || normalized.contains("준비 완료");
    }

    private AccessibilityNodeInfo findActiveOrderCardByCode(
        AccessibilityNodeInfo node,
        String targetCode,
        boolean insideActiveOrders
    ) {
        if (node == null) return null;
        String viewId = value(node.getViewIdResourceName());
        boolean inside = insideActiveOrders || viewId.endsWith("/ub_ueo_active_order_land_container");
        if (inside && targetCode.equals(findOrderCode(node))) {
            if (node.isClickable() || viewId.endsWith("/ub__orders_item_subtitle_text")) {
                return AccessibilityNodeInfo.obtain(node);
            }
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            AccessibilityNodeInfo match = findActiveOrderCardByCode(child, targetCode, inside);
            child.recycle();
            if (match != null) return match;
        }
        return null;
    }

    private boolean treeContainsOrderCode(AccessibilityNodeInfo node, String targetCode) {
        if (node == null) return false;
        if (targetCode.equals(extractOrderCode(value(node.getText())))) return true;
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            boolean match = treeContainsOrderCode(child, targetCode);
            child.recycle();
            if (match) return true;
        }
        return false;
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
                item.put("enabled", node.isEnabled());
                item.put("clickable", node.isClickable());
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

    private boolean containsActiveOrderAction(JSONArray nodes) {
        for (int index = 0; index < nodes.length(); index += 1) {
            JSONObject node = nodes.optJSONObject(index);
            if (node == null) continue;
            String viewId = node.optString("viewId");
            if (!viewId.endsWith("/ub__order_details_action_secondary_button")) continue;
            if (!node.optBoolean("enabled", false)) continue;
            if (isActiveOrderActionText(
                node.optString("text") + "\n" + node.optString("contentDescription")
            )) return true;
        }
        return false;
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
            String path = node.optString("path");
            String signature = path.isEmpty()
                ? node.optString("viewId")
                    + "\n" + node.optString("text")
                    + "\n" + node.optString("contentDescription")
                : path + "\n" + node.optString("viewId");
            accumulatedNodes.put(signature, node);
        }
    }

    private JSONArray accumulatedNodeArray() {
        JSONArray result = new JSONArray();
        for (JSONObject node : accumulatedNodes.values()) result.put(node);
        return result;
    }

    private void scrollOrderDetailsForward() {
        if (!UberRecoveryState.wasOpenedAutomatically(this)) return;
        if (scrollSteps >= 12) {
            finishAutomaticRecovery();
            return;
        }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        if (!hasActiveOrderAction(root)) {
            root.recycle();
            scheduleRecovery(250L);
            return;
        }
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
        long nextRunAt = SystemClock.uptimeMillis() + Math.max(0L, delayMs);
        if (recoveryScheduledAt > 0L && recoveryScheduledAt <= nextRunAt) return;
        handler.removeCallbacks(recoveryRunnable);
        recoveryScheduledAt = nextRunAt;
        handler.postDelayed(recoveryRunnable, delayMs);
    }

    private void recoverNewOrder() {
        boolean pending = UberRecoveryState.isPending(this);
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            if (pending) scheduleRecovery(1500L);
            return;
        }
        String packageName = value(root.getPackageName());
        if (!looksLikeUber(packageName)) {
            root.recycle();
            if (pending) {
                UberRecoveryState.launchUber(this);
                scheduleRecovery(1500L);
            }
            return;
        }
        if (!pending) {
            if (hasViewId(root, "ub__ueo_orders_header_title")) {
                ensureActiveOrderRecovery(root);
            }
            root.recycle();
            if (UberRecoveryState.isPending(this)) scheduleRecovery(2500L);
            return;
        }
        if (hasViewId(root, "ub__ueo_order_details_header_title")) {
            StringBuilder builder = new StringBuilder();
            JSONArray nodes = new JSONArray();
            collectNodes(root, "0", builder, nodes, new HashSet<>());
            root.recycle();
            if (containsActiveOrderAction(nodes)) {
                captureOrderDetails(packageName, builder, nodes);
            } else if (UberRecoveryState.mayNavigateBack(this)) {
                performGlobalAction(GLOBAL_ACTION_BACK);
                scheduleRecovery(1000L);
            }
            return;
        }
        if (hasViewId(root, "ub__ueo_orders_header_title")) {
            AccessibilityNodeInfo orderCard = findActiveOrderCard(root, false);
            root.recycle();
            if (orderCard != null) {
                UberRecoveryState.noteOrderCardFound(this);
                String orderCode = findOrderCode(orderCard);
                boolean clicked = clickOrderCard(orderCard);
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

    private void ensureActiveOrderRecovery(AccessibilityNodeInfo root) {
        AccessibilityNodeInfo orderCard = findActiveOrderCardByViewId(root);
        if (orderCard == null) orderCard = findActiveOrderCard(root, false);
        if (orderCard == null) {
            logOverviewDiagnostic("No unhandled clickable card found");
            return;
        }
        String orderCode = findOrderCode(orderCard);
        if (orderCode.isEmpty() || UberRecoveryState.wasHandled(this, orderCode)) {
            logOverviewDiagnostic(
                orderCode.isEmpty()
                    ? "Clickable card has no order code"
                    : "Order already handled: " + orderCode
            );
            orderCard.recycle();
            return;
        }
        long now = SystemClock.uptimeMillis();
        if (
            orderCode.equals(lastOrderClickAttemptCode)
            && now - lastOrderClickAttemptAt < 1500L
        ) {
            orderCard.recycle();
            return;
        }
        lastOrderClickAttemptCode = orderCode;
        lastOrderClickAttemptAt = now;
        UberRecoveryState.requestFromActiveOrderOverview(this, orderCode);
        boolean clicked = clickOrderCard(orderCard);
        orderCard.recycle();
        Log.i(TAG, "Direct active-order click " + orderCode + ": " + clicked);
        if (clicked) {
            uploadRecoveryStatus("active_order_clicked", orderCode);
            scheduleRecovery(2500L);
        }
    }

    private AccessibilityNodeInfo findActiveOrderCardByViewId(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> containers = root.findAccessibilityNodeInfosByViewId(
            UBER_ORDERS_PACKAGE + ":id/ub_ueo_active_order_land_container"
        );
        Rect activeBounds = new Rect();
        if (!containers.isEmpty()) containers.get(0).getBoundsInScreen(activeBounds);
        for (AccessibilityNodeInfo container : containers) container.recycle();

        List<AccessibilityNodeInfo> subtitles = root.findAccessibilityNodeInfosByViewId(
            UBER_ORDERS_PACKAGE + ":id/ub__orders_item_subtitle_text"
        );
        AccessibilityNodeInfo match = null;
        for (AccessibilityNodeInfo subtitle : subtitles) {
            Rect bounds = new Rect();
            subtitle.getBoundsInScreen(bounds);
            String orderCode = extractOrderCode(value(subtitle.getText()));
            boolean insideActiveBounds = activeBounds.isEmpty()
                || activeBounds.contains(Math.round(bounds.exactCenterX()), Math.round(bounds.exactCenterY()));
            if (
                match == null
                && insideActiveBounds
                && !orderCode.isEmpty()
                && !UberRecoveryState.wasHandled(this, orderCode)
            ) {
                match = AccessibilityNodeInfo.obtain(subtitle);
            }
            subtitle.recycle();
        }
        if (match == null) {
            logOverviewDiagnostic(
                "Direct lookup containers=" + containers.size() + ", subtitles=" + subtitles.size()
            );
        }
        return match;
    }

    private void logOverviewDiagnostic(String message) {
        long now = SystemClock.uptimeMillis();
        if (now - lastOverviewDiagnosticAt < 5000L) return;
        lastOverviewDiagnosticAt = now;
        Log.i(TAG, message);
    }

    private boolean clickOrderCard(AccessibilityNodeInfo orderCard) {
        if (orderCard.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
        Rect bounds = new Rect();
        orderCard.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) return false;
        Path path = new Path();
        path.moveTo(bounds.exactCenterX(), bounds.exactCenterY());
        GestureDescription gesture = new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0L, 80L))
            .build();
        return dispatchGesture(gesture, null, null);
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

    private boolean hasActiveOrderAction(AccessibilityNodeInfo node) {
        if (node == null) return false;
        String viewId = value(node.getViewIdResourceName());
        if (
            viewId.endsWith("/ub__order_details_action_secondary_button")
            && node.isEnabled()
            && isActiveOrderActionText(value(node.getText()) + "\n" + value(node.getContentDescription()))
        ) return true;
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            boolean match = hasActiveOrderAction(child);
            child.recycle();
            if (match) return true;
        }
        return false;
    }

    private boolean isActiveOrderActionText(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase();
        return normalized.contains("準備完了")
            || normalized.contains("准备完成")
            || normalized.contains("準備完成")
            || normalized.contains("准备好")
            || normalized.contains("注文を受け付け")
            || normalized.contains("接受订单")
            || normalized.contains("接受訂單")
            || normalized.contains("accept order")
            || normalized.contains("mark ready")
            || normalized.contains("ready for pickup")
            || normalized.contains("준비 완료")
            || normalized.contains("주문 수락");
    }

    private AccessibilityNodeInfo findActiveOrderCard(AccessibilityNodeInfo node, boolean insideActiveOrders) {
        if (node == null) return null;
        String viewId = value(node.getViewIdResourceName());
        boolean inside = insideActiveOrders || viewId.endsWith("/ub_ueo_active_order_land_container");
        if (inside && viewId.endsWith("/ub__orders_item_subtitle_text")) {
            String orderCode = extractOrderCode(value(node.getText()));
            if (!orderCode.isEmpty() && !UberRecoveryState.wasHandled(this, orderCode)) {
                return AccessibilityNodeInfo.obtain(node);
            }
        }
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
