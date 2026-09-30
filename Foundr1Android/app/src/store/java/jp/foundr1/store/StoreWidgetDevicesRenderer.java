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
            boolean fresh = StoreWidgetDevicePolicy.fresh(device, android.os.SystemClock.elapsedRealtime());
            if (fresh) {
                state = (zh ? "上次 " : "前回 ") + StoreWidgetDevicePolicy.state(device, zh);
                if ("bot".equals(device.optString("kind")) && StoreWidgetDevicePolicy.hasAction(device, "press")) state = zh ? "按一下" : "スイッチを押す";
                long at = StoreWidgetDevicePolicy.time(device.optString("fetchedAt"));
                String time = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.JAPAN).format(new java.util.Date(at));
                detail = (zh ? "上次读取 " : "前回確認 ") + time;
            }
            int root = slot == 0 ? R.id.inventory_widget_device_left : R.id.inventory_widget_device_right;
            int title = slot == 0 ? R.id.inventory_widget_device_left_title : R.id.inventory_widget_device_right_title;
            int icon = slot == 0 ? R.id.inventory_widget_device_left_icon : R.id.inventory_widget_device_right_icon;
            views.setTextViewText(title, name);
            views.setViewVisibility(title, size == InventoryWidgetPolicy.DENSE ? View.GONE : View.VISIBLE);
            views.setImageViewResource(icon, configured ? icon(binding, device) : R.drawable.inventory_widget_device_add);
            views.setContentDescription(root, name + "，" + state + "，" + detail);
            views.setOnClickPendingIntent(root, configured ? action(context, id, slot, store, key) : InventoryWidgetProvider.configurationIntent(context, id));
        }
    }

    // Icons identify the device, never claim that a cached physical state is current.
    static int icon(JSONObject binding, JSONObject device) {
        String kind = device == null ? binding.optString("kind") : device.optString("kind", binding.optString("kind"));
        String name = binding.optString("name").toLowerCase(java.util.Locale.ROOT);
        if ("lock".equals(kind)) return R.drawable.inventory_widget_device_lock;
        if ("shade".equals(kind)) return R.drawable.inventory_widget_device_shade;
        if ("indoorLight".equals(kind)) return R.drawable.inventory_widget_device_light;
        if (kind.isEmpty()) {
            if (matches(name, "lock", "门锁", "門鎖", "ロック", "鍵")) return R.drawable.inventory_widget_device_lock;
            if (matches(name, "shade", "blind", "curtain", "卷帘", "窗帘", "捲簾", "窗簾", "スクリーン", "カーテン")) return R.drawable.inventory_widget_device_shade;
        }
        if (matches(name, "間接", "氛围", "氛圍", "ambient", "mood", "lamp", "ランプ")) return R.drawable.inventory_widget_device_lamp;
        if (matches(name, "照明", "灯", "燈", "ライト", "light", "看板")) return R.drawable.inventory_widget_device_light;
        return "plug".equals(kind) ? R.drawable.inventory_widget_device_plug : R.drawable.inventory_widget_device_power;
    }

    private static boolean matches(String name, String... labels) {
        for (String label : labels) if (name.contains(label)) return true;
        return false;
    }
    static PendingIntent action(Context context, int id, int slot, String store, String key) {
        Intent intent = new Intent(context, StoreWidgetDeviceActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_STORE, store).putExtra(StoreWidgetDeviceActivity.EXTRA_KEY, key)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, slot).putExtra(StoreWidgetDeviceActivity.EXTRA_SESSION, InventoryApiClient.sessionKey())
            .setData(Uri.parse("foundr1://widget-devices/" + id + "/" + slot + "/" + store + "/" + key));
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
