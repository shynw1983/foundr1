package jp.foundr1.store;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver.PendingResult;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

public class InventoryWidgetProvider extends AppWidgetProvider {
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

    private static PendingIntent actionIntent(Context context, int widgetId, String mode) {
        String language = language(context, widgetId);
        Intent intent = new Intent(context, QuickInventoryActivity.class);
        intent.putExtra(QuickInventoryActivity.EXTRA_MODE, mode);
        intent.putExtra(QuickInventoryActivity.EXTRA_LANGUAGE, language);
        intent.putExtra(QuickInventoryActivity.EXTRA_STORE_ID, storeId(context, widgetId));
        intent.putExtra(QuickInventoryActivity.EXTRA_STORE_NAME, storeName(context, widgetId));
        intent.putExtra(QuickInventoryActivity.EXTRA_BRAND_ID, brandId(context, widgetId));
        intent.putExtra(QuickInventoryActivity.EXTRA_BRAND_NAME, brandName(context, widgetId));
        intent.setData(Uri.parse("foundr1://inventory-widget/" + widgetId + "/" + mode));
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int requestCode = widgetId * 10 + (QuickInventoryActivity.MODE_RESTORE.equals(mode) ? 2 : 1);
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent configurationIntent(Context context, int widgetId) {
        Intent intent = new Intent(context, InventoryWidgetConfigActivity.class);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        intent.setData(Uri.parse("foundr1://inventory-widget/" + widgetId + "/configure"));
        return PendingIntent.getActivity(
            context,
            widgetId * 10 + 9,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) manager.updateAppWidget(widgetId, baseViews(context, widgetId));
        PendingResult pendingResult = goAsync();
        refreshStatusAsync(context, manager, widgetIds, pendingResult::finish);
    }

    @Override
    public void onDeleted(Context context, int[] widgetIds) {
        android.content.SharedPreferences.Editor editor = context
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit();
        for (int widgetId : widgetIds) {
            editor.remove(LANGUAGE_PREFIX + widgetId);
            editor.remove(STORE_ID_PREFIX + widgetId);
            editor.remove(STORE_NAME_PREFIX + widgetId);
            editor.remove(BRAND_ID_PREFIX + widgetId);
            editor.remove(BRAND_NAME_PREFIX + widgetId);
        }
        editor.apply();
    }

    private static RemoteViews baseViews(Context context, int widgetId) {
        boolean chinese = LANGUAGE_ZH.equals(language(context, widgetId));
        String storeId = storeId(context, widgetId);
        String storeName = storeName(context, widgetId);
        String brandName = brandName(context, widgetId);
        String allBrands = chinese ? "全部品牌" : "全ブランド";
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.quick_inventory_widget);
        views.setTextViewText(
            R.id.inventory_widget_title,
            storeId.isEmpty() ? "Foundr1 Store" : storeName + " · " + (brandName.isEmpty() ? allBrands : brandName)
        );
        views.setTextViewText(R.id.inventory_widget_shortage, chinese ? "设置缺货" : "欠品登録");
        views.setTextViewText(R.id.inventory_widget_restore, chinese ? "到货・恢复销售" : "入荷・販売再開");
        views.setTextViewText(
            R.id.inventory_widget_status,
            storeId.isEmpty() ? (chinese ? "请设置门店" : "店舗を設定") : (chinese ? "正在确认库存…" : "在庫状態を確認中…")
        );
        PendingIntent shortageIntent = storeId.isEmpty()
            ? configurationIntent(context, widgetId)
            : actionIntent(context, widgetId, QuickInventoryActivity.MODE_SHORTAGE);
        PendingIntent restoreIntent = storeId.isEmpty()
            ? configurationIntent(context, widgetId)
            : actionIntent(context, widgetId, QuickInventoryActivity.MODE_RESTORE);
        views.setOnClickPendingIntent(R.id.inventory_widget_shortage, shortageIntent);
        views.setOnClickPendingIntent(R.id.inventory_widget_restore, restoreIntent);
        views.setOnClickPendingIntent(R.id.inventory_widget_title, configurationIntent(context, widgetId));
        return views;
    }

    private static String statusLabel(Context context, int widgetId, Integer unavailable, boolean hasData) {
        boolean chinese = LANGUAGE_ZH.equals(language(context, widgetId));
        if (storeId(context, widgetId).isEmpty()) return chinese ? "请设置门店" : "店舗を設定";
        if (!hasData) return chinese ? "需要登录／更新" : "要ログイン／更新";
        if (unavailable == null || unavailable == 0) return chinese ? "没有缺货" : "欠品なし";
        return chinese ? "缺货 " + unavailable + " 项" : "欠品 " + unavailable + "件";
    }

    private static void refreshStatusAsync(
        Context context,
        AppWidgetManager manager,
        int[] widgetIds,
        Runnable finish
    ) {
        Context appContext = context.getApplicationContext();
        new Thread(() -> {
            Map<String, JSONObject> dataByStore = new HashMap<>();
            for (int widgetId : widgetIds) {
                String storeId = storeId(appContext, widgetId);
                JSONObject body = null;
                boolean hasData = false;
                if (!storeId.isEmpty()) {
                    body = dataByStore.get(storeId);
                    if (body == null) {
                        try {
                            body = InventoryApiClient.loadAll(storeId);
                            InventoryApiClient.saveCache(appContext, storeId, body);
                            dataByStore.put(storeId, body);
                        } catch (Exception error) {
                            body = InventoryApiClient.readCache(appContext, storeId);
                        }
                    }
                    hasData = body != null;
                }
                Integer unavailable = hasData
                    ? InventoryApiClient.unavailableCount(body, brandId(appContext, widgetId))
                    : null;
                RemoteViews views = baseViews(appContext, widgetId);
                views.setTextViewText(
                    R.id.inventory_widget_status,
                    statusLabel(appContext, widgetId, unavailable, hasData)
                );
                manager.updateAppWidget(widgetId, views);
            }
            finish.run();
        }, "foundr1-widget-refresh").start();
    }

    static void refreshWidget(Context context, int widgetId) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        manager.updateAppWidget(widgetId, baseViews(context, widgetId));
        refreshStatusAsync(context, manager, new int[] { widgetId }, () -> {});
    }

    static void refreshWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, InventoryWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        if (ids.length == 0) return;
        for (int id : ids) manager.updateAppWidget(id, baseViews(context, id));
        refreshStatusAsync(context, manager, ids, () -> {});
    }
}
