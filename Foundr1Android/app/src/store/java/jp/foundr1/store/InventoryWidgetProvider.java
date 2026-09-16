package jp.foundr1.store;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;

import org.json.JSONObject;

import java.util.Map;

public class InventoryWidgetProvider extends AppWidgetProvider {
    private static final String ACTION_REFRESH = "jp.foundr1.store.INVENTORY_WIDGET_REFRESH";
    static final String LANGUAGE_JA = "ja";
    static final String LANGUAGE_ZH = "zh";
    private static final String PREFERENCES = "inventory_widget_settings";
    private static final String LANGUAGE_PREFIX = "language_";
    private static final String STORE_ID_PREFIX = "store_id_";
    private static final String STORE_NAME_PREFIX = "store_name_";
    private static final String BRAND_ID_PREFIX = "brand_id_";
    private static final String BRAND_NAME_PREFIX = "brand_name_";

    static void saveConfiguration(
        Context context,
        int widgetId,
        String language,
        String storeId,
        String storeName,
        String brandId,
        String brandName
    ) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(LANGUAGE_PREFIX + widgetId, LANGUAGE_ZH.equals(language) ? LANGUAGE_ZH : LANGUAGE_JA)
            .putString(STORE_ID_PREFIX + widgetId, safe(storeId))
            .putString(STORE_NAME_PREFIX + widgetId, safe(storeName))
            .putString(BRAND_ID_PREFIX + widgetId, safe(brandId))
            .putString(BRAND_NAME_PREFIX + widgetId, safe(brandName))
            .apply();
    }

    static String language(Context context, int widgetId) {
        return preference(context, LANGUAGE_PREFIX, widgetId, LANGUAGE_JA);
    }

    static String storeId(Context context, int widgetId) {
        return preference(context, STORE_ID_PREFIX, widgetId, "");
    }

    static String storeName(Context context, int widgetId) {
        return preference(context, STORE_NAME_PREFIX, widgetId, "");
    }

    static String brandId(Context context, int widgetId) {
        return preference(context, BRAND_ID_PREFIX, widgetId, "");
    }

    static String brandName(Context context, int widgetId) {
        return preference(context, BRAND_NAME_PREFIX, widgetId, "");
    }

    private static String preference(Context context, String prefix, int widgetId, String fallback) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(prefix + widgetId, fallback);
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static PendingIntent actionIntent(Context context, int widgetId, String mode, JSONObject item) {
        Intent intent = new Intent(context, QuickInventoryActivity.class);
        intent.putExtra(QuickInventoryActivity.EXTRA_MODE, mode);
        intent.putExtra(QuickInventoryActivity.EXTRA_LANGUAGE, language(context, widgetId));
        intent.putExtra(QuickInventoryActivity.EXTRA_STORE_ID, storeId(context, widgetId));
        intent.putExtra(QuickInventoryActivity.EXTRA_STORE_NAME, storeName(context, widgetId));
        intent.putExtra(QuickInventoryActivity.EXTRA_BRAND_ID, brandId(context, widgetId));
        intent.putExtra(QuickInventoryActivity.EXTRA_BRAND_NAME, brandName(context, widgetId));
        String identity = "all";
        if (item != null) {
            intent.putExtra(QuickInventoryActivity.EXTRA_TARGET_ID, item.optString("targetId"));
            intent.putExtra(QuickInventoryActivity.EXTRA_TARGET_KIND, item.optString("targetKind"));
            intent.putExtra(QuickInventoryActivity.EXTRA_TARGET_BRAND, item.optString("brandId"));
            identity = item.optString("brandId") + ":" + item.optString("targetKind") + ":" + item.optString("targetId");
        }
        intent.setData(Uri.parse("foundr1://inventory-widget/" + widgetId + "/" + mode + "/" + Uri.encode(identity)));
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, widgetId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent configurationIntent(Context context, int widgetId) {
        Intent intent = new Intent(context, InventoryWidgetConfigActivity.class);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        intent.setData(Uri.parse("foundr1://inventory-widget/" + widgetId + "/configure"));
        return PendingIntent.getActivity(context, widgetId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent refreshIntent(Context context, int widgetId) {
        android.appwidget.AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(widgetId);
        Intent intent = new Intent(ACTION_REFRESH);
        intent.setComponent(info == null ? new ComponentName(context, InventoryWidgetProvider.class) : info.provider);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        intent.setData(Uri.parse("foundr1://inventory-widget/" + widgetId + "/refresh"));
        return PendingIntent.getBroadcast(context, widgetId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent detailIntent(Context context, int widgetId) {
        Intent intent = new Intent(context, InventoryWidgetSyncActivity.class);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        intent.setData(Uri.parse("foundr1://inventory-widget/" + widgetId + "/sync"));
        return PendingIntent.getActivity(context, widgetId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (AppWidgetManager.getInstance(context).getAppWidgetInfo(id) != null) refreshWidget(context, id);
        } else super.onReceive(context, intent);
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) renderWidget(context, id);
        InventoryWidgetRefreshWorker.enqueue(context);
    }

    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        renderWidget(context, id);
    }

    @Override public void onDeleted(Context context, int[] widgetIds) {
        android.content.SharedPreferences.Editor editor = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit();
        for (int id : widgetIds) {
            for (String prefix : new String[] { LANGUAGE_PREFIX, STORE_ID_PREFIX, STORE_NAME_PREFIX, BRAND_ID_PREFIX, BRAND_NAME_PREFIX }) {
                editor.remove(prefix + id);
            }
        }
        editor.apply();
    }

    static int[] widgetIds(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] summary = manager.getAppWidgetIds(new ComponentName(context, InventoryWidgetProvider.class));
        int[] quick = manager.getAppWidgetIds(new ComponentName(context, InventoryQuickWidgetProvider.class));
        int[] ids = java.util.Arrays.copyOf(summary, summary.length + quick.length);
        System.arraycopy(quick, 0, ids, summary.length, quick.length);
        return ids;
    }

    static void renderWidget(Context context, int widgetId) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        android.appwidget.AppWidgetProviderInfo info = manager.getAppWidgetInfo(widgetId);
        if (info == null) return;
        InventoryWidgetData data = InventoryWidgetData.read(context, widgetId);
        RemoteViews views;
        if (Build.VERSION.SDK_INT >= 31) {
            Map<SizeF, RemoteViews> layouts = new java.util.LinkedHashMap<>();
            layouts.put(new SizeF(110, 56), views(context, widgetId, InventoryWidgetPolicy.COMPACT, data));
            layouts.put(new SizeF(250, 110), views(context, widgetId, InventoryWidgetPolicy.DENSE, data));
            layouts.put(new SizeF(InventoryWidgetPolicy.SUMMARY_WIDTH, InventoryWidgetPolicy.SUMMARY_HEIGHT),
                views(context, widgetId, InventoryWidgetPolicy.SUMMARY, data));
            layouts.put(new SizeF(InventoryWidgetPolicy.SUMMARY_WIDTH, InventoryWidgetPolicy.EXPANDED_HEIGHT),
                views(context, widgetId, InventoryWidgetPolicy.EXPANDED, data));
            views = new RemoteViews(layouts);
        } else {
            Bundle options = manager.getAppWidgetOptions(widgetId);
            boolean quick = InventoryQuickWidgetProvider.class.getName().equals(info.provider.getClassName());
            int minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, quick ? 110 : 250);
            int maxWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, minWidth);
            int minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, quick ? 56 : 156);
            int maxHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, minHeight);
            views = new RemoteViews(
                views(context, widgetId, InventoryWidgetPolicy.layout(maxWidth, minHeight), data),
                views(context, widgetId, InventoryWidgetPolicy.layout(minWidth, maxHeight), data));
        }
        manager.updateAppWidget(widgetId, views);
    }

    private static RemoteViews views(Context context, int id, int size, InventoryWidgetData data) {
        boolean zh = LANGUAGE_ZH.equals(language(context, id));
        boolean compact = size == InventoryWidgetPolicy.COMPACT;
        boolean configured = !storeId(context, id).isEmpty();
        RemoteViews views = new RemoteViews(context.getPackageName(), compact
            ? R.layout.quick_inventory_widget_compact : size == InventoryWidgetPolicy.DENSE
                ? R.layout.quick_inventory_widget_dense : R.layout.quick_inventory_widget);
        String scope = configured ? storeName(context, id) + " · "
            + (brandName(context, id).isEmpty() ? (zh ? "全部品牌" : "全ブランド") : brandName(context, id)) : "Foundr1 Store";
        views.setTextViewText(R.id.inventory_widget_title, scope);
        views.setContentDescription(R.id.inventory_widget_title, scope + (zh ? "，小组件设置" : "、ウィジェット設定"));
        views.setOnClickPendingIntent(R.id.inventory_widget_title, configurationIntent(context, id));
        views.setTextViewText(R.id.inventory_widget_shortage, compact ? (zh ? "缺货" : "欠品") : (zh ? "缺货登记" : "欠品登録"));
        views.setTextViewText(R.id.inventory_widget_restore, compact ? (zh ? "恢复" : "再開") : (zh ? "恢复销售" : "販売再開"));
        views.setOnClickPendingIntent(R.id.inventory_widget_shortage, configured
            ? actionIntent(context, id, QuickInventoryActivity.MODE_SHORTAGE, null) : configurationIntent(context, id));
        views.setOnClickPendingIntent(R.id.inventory_widget_restore, configured
            ? actionIntent(context, id, QuickInventoryActivity.MODE_RESTORE, null) : configurationIntent(context, id));
        if (compact) return views;

        String error = InventoryWidgetData.denied(data.syncError) ? data.syncError : data.inventoryError;
        String status = !configured ? (zh ? "请设置门店" : "店舗を設定")
            : !data.hasInventory ? errorText(error, zh)
            : data.shortages.isEmpty() ? (zh ? "暂无缺货" : "欠品なし")
            : (zh ? "缺货 " + data.shortages.size() + " 项" : "欠品 " + data.shortages.size() + "件");
        views.setTextViewText(R.id.inventory_widget_status, status);
        views.setOnClickPendingIntent(R.id.inventory_widget_status, configured
            ? actionIntent(context, id, QuickInventoryActivity.MODE_RESTORE, null) : configurationIntent(context, id));
        long checked = data.inventoryCheckedAt;
        if (data.syncCheckedAt > 0 && checked > 0) checked = Math.min(checked, data.syncCheckedAt);
        String stamp = checked > 0 ? shortTime(checked) : (zh ? "刷新" : "更新");
        if (!data.inventoryError.isEmpty() || !data.syncError.isEmpty()) {
            stamp = checked > 0 ? (zh ? "缓存 " : "保存 ") + shortTime(checked) : (zh ? "重试" : "再読込");
        }
        views.setTextViewText(R.id.inventory_widget_refresh, stamp + " ↻");
        views.setContentDescription(R.id.inventory_widget_refresh, (zh ? "刷新，数据更新于 " : "再読込、更新時刻 ") + time(checked));
        views.setOnClickPendingIntent(R.id.inventory_widget_refresh, refreshIntent(context, id));
        views.removeAllViews(R.id.inventory_widget_items);
        views.removeAllViews(R.id.inventory_widget_more);
        int visible = size == InventoryWidgetPolicy.EXPANDED ? 4 : 2;
        for (int i = 0; i < Math.min(visible, data.shortages.size()); i++) {
            JSONObject item = data.shortages.get(i);
            RemoteViews row = new RemoteViews(context.getPackageName(), i < 2 ? R.layout.inventory_widget_item : R.layout.inventory_widget_item_row);
            String label = InventoryWidgetData.itemLabel(item, language(context, id));
            String description = label + " · " + item.optString("brandName") + " · " + item.optString("groupName");
            row.setTextViewText(R.id.inventory_widget_item, i < 2 ? label : description);
            row.setContentDescription(R.id.inventory_widget_item, description + (zh ? "，恢复销售" : "、販売再開"));
            row.setOnClickPendingIntent(R.id.inventory_widget_item, actionIntent(context, id, QuickInventoryActivity.MODE_RESTORE, item));
            views.addView(i < 2 ? R.id.inventory_widget_items : R.id.inventory_widget_more, row);
        }
        if (data.shortages.size() > visible) {
            RemoteViews more = new RemoteViews(context.getPackageName(), R.layout.inventory_widget_item);
            more.setTextViewText(R.id.inventory_widget_item, "+" + (data.shortages.size() - visible) + " ›");
            more.setContentDescription(R.id.inventory_widget_item, zh ? "查看全部缺货" : "欠品をすべて表示");
            more.setOnClickPendingIntent(R.id.inventory_widget_item, actionIntent(context, id, QuickInventoryActivity.MODE_RESTORE, null));
            views.addView(R.id.inventory_widget_items, more);
        }
        String operation = zh ? "暂无可显示的最近操作" : "表示できる直近の操作なし";
        CharSequence platforms = zh ? "同步结果将在这里显示" : "同期結果をここに表示";
        if (data.latestRun != null) {
            operation = (zh ? "最近：" : "直近：") + InventoryWidgetData.runLabel(data.latestRun, language(context, id))
                + " → " + ("available".equals(data.latestRun.optString("action")) ? (zh ? "恢复" : "販売再開") : (zh ? "缺货" : "欠品"));
            platforms = platformSummary(data, zh);
        }
        if (!data.syncError.isEmpty() || !error.isEmpty()) {
            platforms = errorText(data.syncError.isEmpty() ? error : data.syncError, zh)
                + (data.latestRun != null ? (zh ? " · 显示上次结果" : " · 前回の結果") : "");
        } else if (data.syncCheckedAt == 0) {
            platforms = zh ? "同步结果确认中…" : "同期結果を確認中…";
        }
        if (!configured) {
            operation = zh ? "点击门店名称进行设置" : "店舗名をタップして設定";
            platforms = zh ? "选择这个小组件的门店和品牌" : "このウィジェットの店舗・ブランドを選択";
        }
        views.setTextViewText(R.id.inventory_widget_operation, operation);
        views.setTextViewText(R.id.inventory_widget_platforms, platforms);
        views.setOnClickPendingIntent(R.id.inventory_widget_sync, configured ? detailIntent(context, id) : configurationIntent(context, id));
        return views;
    }

    static CharSequence platformSummary(InventoryWidgetData data, boolean zh) {
        SpannableStringBuilder text = new SpannableStringBuilder();
        if (data.failed()) {
            text.append(zh ? "有失败 · " : "失敗あり · ");
            text.setSpan(new ForegroundColorSpan(0xFFA12828), 0, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        for (JSONObject platform : InventoryWidgetData.platforms(data.latestRun)) {
            if (text.length() > 0) text.append("   ");
            String status = InventoryWidgetData.status(platform);
            int start = text.length();
            text.append(InventoryWidgetPolicy.platformName(platform.optString("platform"), zh)).append(" ")
                .append("succeeded".equals(status) ? "✓" : InventoryWidgetPolicy.statusText(status, zh));
            int color = "succeeded".equals(status) ? 0xFF134E3A
                : "failed".equals(status) || "timed_out".equals(status) ? 0xFFA12828 : 0xFF766023;
            text.setSpan(new ForegroundColorSpan(color), start, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return text.length() == 0 ? (zh ? "等待确认同步结果" : "同期結果は未確認") : text;
    }

    static String errorText(String error, boolean zh) {
        if ("auth".equals(error)) return zh ? "需要重新登录" : "再ログインが必要";
        if ("forbidden".equals(error)) return zh ? "无门店权限" : "店舗の権限なし";
        if (!error.isEmpty()) return zh ? "更新失败，点击重试" : "更新失敗・再読込";
        return zh ? "正在读取…" : "読み込み中…";
    }

    static String time(long epoch) {
        return epoch > 0 ? new java.text.SimpleDateFormat("MM/dd HH:mm", java.util.Locale.JAPAN).format(new java.util.Date(epoch)) : "—";
    }

    private static String shortTime(long epoch) {
        java.text.SimpleDateFormat day = new java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.JAPAN);
        boolean today = day.format(new java.util.Date()).equals(day.format(new java.util.Date(epoch)));
        return new java.text.SimpleDateFormat(today ? "HH:mm" : "MM/dd HH:mm", java.util.Locale.JAPAN).format(new java.util.Date(epoch));
    }

    static void refreshWidget(Context context, int widgetId) {
        renderWidget(context, widgetId);
        InventoryWidgetRefreshWorker.enqueue(context);
    }

    static void refreshWidgets(Context context) {
        int[] ids = widgetIds(context);
        if (ids.length == 0) return;
        for (int id : ids) renderWidget(context, id);
        InventoryWidgetRefreshWorker.enqueue(context);
    }
}
