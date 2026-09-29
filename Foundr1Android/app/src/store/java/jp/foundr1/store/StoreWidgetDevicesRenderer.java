package jp.foundr1.store;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

final class StoreWidgetDevicesRenderer {
    static void bind(Context context, RemoteViews views, int id, int size) {
        boolean zh = "zh".equals(InventoryWidgetProvider.language(context, id));
        String store = InventoryWidgetProvider.storeId(context, id);
        for (int slot = 0; slot < 2; slot++) {
            JSONObject binding = StoreWidgetDevicesData.slot(context, id, slot);
            String key = binding.optString("key");
            boolean configured = StoreWidgetDevicePolicy.validKey(key);
            JSONObject device = configured ? StoreWidgetDevicesData.read(context, store, key) : null;
            String name = binding.optString("name", (zh ? "设备 " : "機器 ") + (slot + 1));
            String state = configured ? (zh ? "点按确认" : "タップして確認") : (zh ? "选择设备" : "機器を選ぶ");
            String detail = configured ? (zh ? "操作前读取状态" : "操作前に状態を確認") : (zh ? "自定义快捷开关" : "ショートカットを設定");
            boolean fresh = StoreWidgetDevicePolicy.fresh(device, System.currentTimeMillis());
            boolean on = false, known = false;
            if (fresh) {
                state = (zh ? "上次 " : "前回 ") + StoreWidgetDevicePolicy.state(device, zh);
                if ("bot".equals(device.optString("kind")) && StoreWidgetDevicePolicy.hasAction(device, "press")) state = zh ? "按一下" : "スイッチを押す";
                long at = StoreWidgetDevicePolicy.time(device.optString("fetchedAt"));
                String time = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.JAPAN).format(new java.util.Date(at));
                detail = (zh ? "上次读取 " : "前回確認 ") + time;
                JSONObject sample = device.optJSONObject("sample");
                if (sample != null) { known = "on".equals(sample.optString("power")) || "off".equals(sample.optString("power")); on = "on".equals(sample.optString("power")); }
            }
            int root = slot == 0 ? R.id.inventory_widget_device_left : R.id.inventory_widget_device_right;
            int title = slot == 0 ? R.id.inventory_widget_device_left_title : R.id.inventory_widget_device_right_title;
            int value = slot == 0 ? R.id.inventory_widget_device_left_value : R.id.inventory_widget_device_right_value;
            int helper = slot == 0 ? R.id.inventory_widget_device_left_detail : R.id.inventory_widget_device_right_detail;
            int indicator = slot == 0 ? R.id.inventory_widget_device_left_indicator : R.id.inventory_widget_device_right_indicator;
            views.setTextViewText(title, name);
            views.setTextViewText(value, state);
            views.setTextViewText(helper, detail);
            views.setViewVisibility(helper, size == InventoryWidgetPolicy.EXPANDED ? View.VISIBLE : View.GONE);
            views.setImageViewResource(indicator, known ? (on ? R.drawable.inventory_widget_toggle_on : R.drawable.inventory_widget_toggle_off) : R.drawable.inventory_widget_chevron);
            views.setContentDescription(root, name + "，" + state + "，" + detail);
            views.setOnClickPendingIntent(root, configured ? action(context, id, slot, store, key) : InventoryWidgetProvider.configurationIntent(context, id));
        }
    }
    static PendingIntent action(Context context, int id, int slot, String store, String key) {
        Intent intent = new Intent(context, StoreWidgetDeviceActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_STORE, store).putExtra(StoreWidgetDeviceActivity.EXTRA_KEY, key)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, slot).putExtra(StoreWidgetDeviceActivity.EXTRA_SESSION, InventoryApiClient.sessionKey())
            .setData(Uri.parse("foundr1://widget-devices/" + id + "/" + slot + "/" + store + "/" + key));
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
