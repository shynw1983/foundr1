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

public class InventoryWidgetProvider extends AppWidgetProvider {
    static final String LANGUAGE_JA = "ja";
    static final String LANGUAGE_ZH = "zh";
    private static final String PREFERENCES = "inventory_widget_settings";
    private static final String LANGUAGE_PREFIX = "language_";

    static void saveLanguage(Context context, int widgetId, String language) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(LANGUAGE_PREFIX + widgetId, LANGUAGE_ZH.equals(language) ? LANGUAGE_ZH : LANGUAGE_JA)
            .apply();
    }

    static String language(Context context, int widgetId) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(LANGUAGE_PREFIX + widgetId, LANGUAGE_JA);
    }

    private static PendingIntent actionIntent(Context context, int widgetId, String mode, String language) {
        Intent intent = new Intent(context, QuickInventoryActivity.class);
        intent.putExtra(QuickInventoryActivity.EXTRA_MODE, mode);
        intent.putExtra(QuickInventoryActivity.EXTRA_LANGUAGE, language);
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
        for (int widgetId : widgetIds) editor.remove(LANGUAGE_PREFIX + widgetId);
        editor.apply();
    }

    private static RemoteViews baseViews(Context context, int widgetId) {
        String language = language(context, widgetId);
        boolean chinese = LANGUAGE_ZH.equals(language);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.quick_inventory_widget);
        views.setTextViewText(R.id.inventory_widget_shortage, chinese ? "设置缺货" : "欠品登録");
        views.setTextViewText(R.id.inventory_widget_restore, chinese ? "到货・恢复销售" : "入荷・販売再開");
        views.setTextViewText(R.id.inventory_widget_status, chinese ? "正在确认库存…" : "在庫状態を確認中…");
        views.setOnClickPendingIntent(
            R.id.inventory_widget_shortage,
            actionIntent(context, widgetId, QuickInventoryActivity.MODE_SHORTAGE, language)
        );
        views.setOnClickPendingIntent(
            R.id.inventory_widget_restore,
            actionIntent(context, widgetId, QuickInventoryActivity.MODE_RESTORE, language)
        );
        return views;
    }

    private static String statusLabel(Context context, int widgetId, Integer unavailable, boolean hasData) {
        boolean chinese = LANGUAGE_ZH.equals(language(context, widgetId));
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
            Integer unavailable = null;
            boolean hasData = false;
            try {
                JSONObject body = InventoryApiClient.loadAll();
                InventoryApiClient.saveCache(appContext, body);
                unavailable = InventoryApiClient.unavailableCount(body);
                hasData = true;
            } catch (Exception error) {
                JSONObject cached = InventoryApiClient.readCache(appContext);
                if (cached != null) {
                    unavailable = InventoryApiClient.unavailableCount(cached);
                    hasData = true;
                }
            }
            for (int widgetId : widgetIds) {
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
