package jp.foundr1.store;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

final class StoreWidgetControlsRenderer {
    static void bind(Context context, RemoteViews views, int id, int size, InventoryWidgetData data,
        PendingIntent inventory, PendingIntent refresh) {
        boolean zh = "zh".equals(InventoryWidgetProvider.language(context, id));
        String error = InventoryWidgetData.denied(data.syncError) ? data.syncError : data.inventoryError;
        boolean failed = data.failed() || !error.isEmpty() || !data.syncError.isEmpty();
        CharSequence summary = !error.isEmpty() || !data.syncError.isEmpty()
            ? InventoryWidgetProvider.errorText(data.syncError.isEmpty() ? error : data.syncError, zh)
            : data.latestRun == null ? (zh ? "暂无最近操作" : "直近の操作なし") : InventoryWidgetProvider.syncSummary(data, zh);
        views.setTextViewText(R.id.inventory_widget_count, data.hasInventory ? String.valueOf(data.shortages.size()) : "—");
        views.setTextViewText(R.id.inventory_widget_status, zh ? "缺货" : "欠品");
        views.setContentDescription(R.id.inventory_widget_metric, data.hasInventory
            ? (zh ? "缺货 " + data.shortages.size() + " 项，查看全部" : "欠品 " + data.shortages.size() + "件、すべて表示")
            : InventoryWidgetProvider.errorText(error, zh));
        views.setOnClickPendingIntent(R.id.inventory_widget_metric, inventory);
        views.setTextViewText(R.id.inventory_widget_refresh, failed ? "!" : "↻");
        views.setTextColor(R.id.inventory_widget_refresh, context.getColor(failed ? R.color.widget_error : R.color.widget_muted));
        views.setContentDescription(R.id.inventory_widget_refresh, failed ? summary : (zh ? "刷新小组件" : "ウィジェットを再読込"));
        views.setOnClickPendingIntent(R.id.inventory_widget_refresh, failed ? InventoryWidgetProvider.detailIntent(context, id) : refresh);
        views.setTextViewText(R.id.inventory_widget_platforms, summary);
        views.setTextViewText(R.id.inventory_widget_operation, InventoryWidgetProvider.time(data.syncCheckedAt));
        views.setTextColor(R.id.inventory_widget_platforms, context.getColor(failed ? R.color.widget_error : R.color.widget_muted));
        views.setViewVisibility(R.id.inventory_widget_sync, size == InventoryWidgetPolicy.EXPANDED ? View.VISIBLE : View.GONE);
        views.setOnClickPendingIntent(R.id.inventory_widget_sync, InventoryWidgetProvider.detailIntent(context, id));
        StoreWidgetControlsData controls = StoreWidgetControlsData.read(context, InventoryWidgetProvider.storeId(context, id));
        String[] shortcuts = InventoryWidgetProvider.shortcuts(context, id);
        for (int slot = 0; slot < 2; slot++) control(context, views, id, slot, shortcuts[slot], size, controls, data);
    }

    static PendingIntent action(Context context, int id, String key, StoreWidgetControlsData controls) {
        String store = InventoryWidgetProvider.storeId(context, id);
        Intent intent = new Intent(context, StoreWidgetControlActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .putExtra(StoreWidgetControlActivity.EXTRA_STORE, store)
            .putExtra(StoreWidgetControlActivity.EXTRA_CONTROL, key);
        String identity = store;
        if (StoreWidgetControlsPolicy.AWAY.equals(key) && controls.canToggle()) {
            boolean desired = !controls.preference().optBoolean("enabled");
            String version = controls.preference().optString("version");
            intent.putExtra(StoreWidgetControlActivity.EXTRA_ENABLED, desired)
                .putExtra(StoreWidgetControlActivity.EXTRA_VERSION, version)
                .putExtra(StoreWidgetControlActivity.EXTRA_SESSION, InventoryApiClient.sessionKey());
            identity += "/" + version + "/" + desired;
        }
        intent.setData(Uri.parse("foundr1://widget-controls/" + id + "/" + key + "/" + identity));
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void control(Context context, RemoteViews views, int id, int slot, String key, int size,
        StoreWidgetControlsData controls, InventoryWidgetData data) {
        boolean zh = "zh".equals(InventoryWidgetProvider.language(context, id));
        String title = StoreWidgetControlsPolicy.title(key, zh), value, detail;
        boolean warning = false, on = false, toggle = false;
        PendingIntent pending;
        if (StoreWidgetControlsPolicy.SYNC.equals(key)) {
            value = data.latestRun == null ? (zh ? "暂无操作" : "操作なし") : data.failed() ? (zh ? "同步失败" : "同期失敗")
                : data.pending() ? (zh ? "同步中" : "同期中") : (zh ? "查看结果" : "結果を見る");
            if (data.latestRun != null && !data.failed() && !data.pending()) {
                java.util.List<JSONObject> platforms = InventoryWidgetData.platforms(data.latestRun);
                boolean complete = !platforms.isEmpty();
                for (JSONObject platform : platforms) complete &= "succeeded".equals(InventoryWidgetData.status(platform));
                value = complete ? (zh ? "全部完成" : "同期完了") : (zh ? "待确认" : "未確認");
            }
            if (!data.syncError.isEmpty()) value = StoreWidgetControlsData.unavailable(data.syncError, zh);
            detail = InventoryWidgetProvider.syncSummary(data, zh).toString();
            warning = data.failed() || !data.syncError.isEmpty();
            pending = InventoryWidgetProvider.detailIntent(context, id);
        } else if (StoreWidgetControlsPolicy.ORDERS.equals(key)) {
            value = zh ? "查看订单" : "注文を見る";
            detail = zh ? "这家店的订单" : "この店舗の注文";
            String store = InventoryWidgetProvider.storeId(context, id);
            Intent open = new Intent(context, MainActivity.class).putExtra("foundr1_href", "/store/orders?storeId=" + store)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .setData(Uri.parse("foundr1://widget-controls/" + id + "/orders/" + store));
            pending = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        } else if (StoreWidgetControlsPolicy.RECEPTION.equals(key)) {
            boolean fresh = controls.receptionFresh();
            value = fresh ? StoreWidgetControlsPolicy.mode(controls.operation.optString("acceptanceMode"), zh)
                : StoreWidgetControlsData.unavailable(controls.receptionError, zh);
            detail = fresh ? (zh ? "点击选择预约模式" : "タップして受付を変更") : (zh ? "点击重新读取" : "タップして再確認");
            warning = !controls.receptionError.isEmpty();
            pending = action(context, id, key, controls);
        } else {
            JSONObject pref = controls.preference();
            if (!controls.notificationFresh()) {
                value = StoreWidgetControlsData.unavailable(controls.notificationError, zh);
                detail = zh ? "点击重新读取" : "タップして再確認";
            } else if (!controls.notification.optBoolean("ready") || pref == null) {
                value = zh ? "未设置" : "未設定";
                detail = zh ? "先设置账号和距离" : "対象・距離を設定";
            } else {
                on = pref.optBoolean("enabled");
                value = on ? (zh ? "已开启" : "オン") : (zh ? "已关闭" : "オフ");
                detail = on ? (zh ? "离店 " : "離店 ") + pref.optInt("exitRadius") + " m" : (zh ? "不触发离店提醒" : "離店通知を停止");
                toggle = controls.canToggle();
                if (!controls.notification.optBoolean("canManage")) detail = zh ? "仅查看 · 无修改权限" : "閲覧のみ・変更権限なし";
                else if (on && (!controls.notification.optBoolean("deliveryReady")
                    || !controls.notification.optString("sessionId").equals(StoreOrderPush.prefs(context).getString("sessionId", ""))
                    || !StoreOrderPush.hasLocationPermission(context) || !StoreOrderPush.locationEnabled(context)
                    || !context.getSystemService(android.app.NotificationManager.class).areNotificationsEnabled())) {
                    detail = zh ? "请检查手机通知设置" : "端末の通知設定を確認";
                    value = zh ? "开启·待设置" : "オン・要設定";
                    warning = true;
                }
            }
            warning |= !controls.notificationError.isEmpty();
            pending = action(context, id, key, controls);
        }
        if (InventoryWidgetProvider.storeId(context, id).isEmpty()) {
            value = zh ? "请先设置" : "要設定"; pending = InventoryWidgetProvider.configurationIntent(context, id); toggle = false;
        }
        int root = slot == 0 ? R.id.inventory_widget_left : R.id.inventory_widget_right;
        int label = slot == 0 ? R.id.inventory_widget_left_title : R.id.inventory_widget_right_title;
        int state = slot == 0 ? R.id.inventory_widget_left_value : R.id.inventory_widget_right_value;
        int helper = slot == 0 ? R.id.inventory_widget_left_detail : R.id.inventory_widget_right_detail;
        int indicator = slot == 0 ? R.id.inventory_widget_left_indicator : R.id.inventory_widget_right_indicator;
        String shortTitle = StoreWidgetControlsPolicy.RECEPTION.equals(key) ? (zh ? "预约" : "予約")
            : StoreWidgetControlsPolicy.AWAY.equals(key) ? (zh ? "提醒" : "通知")
            : StoreWidgetControlsPolicy.SYNC.equals(key) ? (zh ? "同步" : "同期") : (zh ? "订单" : "注文");
        String denseValue = value;
        if (StoreWidgetControlsPolicy.RECEPTION.equals(key) && controls.receptionFresh()) {
            String mode = controls.operation.optString("acceptanceMode");
            denseValue = "force_open".equals(mode) ? (zh ? "开启" : "受付") : "force_closed".equals(mode) ? (zh ? "关闭" : "停止") : value;
        }
        if (StoreWidgetControlsPolicy.ORDERS.equals(key)) denseValue = zh ? "查看" : "一覧";
        if (StoreWidgetControlsPolicy.AWAY.equals(key) && warning && on) denseValue = zh ? "待设置" : "要設定";
        views.setTextViewText(label, title);
        views.setTextViewText(state, size == InventoryWidgetPolicy.DENSE ? shortTitle + " · " + denseValue : value);
        views.setTextViewText(helper, detail);
        views.setViewVisibility(helper, size == InventoryWidgetPolicy.EXPANDED ? View.VISIBLE : View.GONE);
        views.setTextColor(state, context.getColor(warning ? R.color.widget_warning : R.color.widget_text));
        views.setImageViewResource(indicator, toggle ? (on ? R.drawable.inventory_widget_toggle_on : R.drawable.inventory_widget_toggle_off) : R.drawable.inventory_widget_chevron);
        views.setContentDescription(root, title + "，" + value + "，" + detail);
        views.setOnClickPendingIntent(root, pending);
    }
}
