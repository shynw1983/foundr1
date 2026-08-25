package jp.foundr1.store;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver.PendingResult;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONObject;

public class InventoryWidgetProvider extends AppWidgetProvider {
    private static PendingIntent actionIntent(Context context, String mode, int requestCode) {
        Intent intent = new Intent(context, QuickInventoryActivity.class);
        intent.putExtra(QuickInventoryActivity.EXTRA_MODE, mode);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            RemoteViews views = baseViews(context);
            manager.updateAppWidget(widgetId, views);
        }
        PendingResult pendingResult = goAsync();
        refreshStatusAsync(context, manager, widgetIds, pendingResult::finish);
    }

    private static RemoteViews baseViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.quick_inventory_widget);
        views.setOnClickPendingIntent(
            R.id.inventory_widget_shortage,
            actionIntent(context, QuickInventoryActivity.MODE_SHORTAGE, 6101)
        );
        views.setOnClickPendingIntent(
            R.id.inventory_widget_restore,
            actionIntent(context, QuickInventoryActivity.MODE_RESTORE, 6102)
        );
        return views;
    }

    private static void refreshStatusAsync(
        Context context,
        AppWidgetManager manager,
        int[] widgetIds,
        Runnable finish
    ) {
        Context appContext = context.getApplicationContext();
        new Thread(() -> {
            String statusLabel;
            try {
                JSONObject body = InventoryApiClient.loadAll();
                InventoryApiClient.saveCache(appContext, body);
                int unavailable = InventoryApiClient.unavailableCount(body);
                statusLabel = unavailable == 0 ? "欠品なし" : "欠品 " + unavailable + "件";
            } catch (Exception error) {
                JSONObject cached = InventoryApiClient.readCache(appContext);
                statusLabel = cached == null
                    ? "要ログイン／更新"
                    : "欠品 " + InventoryApiClient.unavailableCount(cached) + "件";
            }
            for (int widgetId : widgetIds) {
                RemoteViews views = baseViews(appContext);
                views.setTextViewText(R.id.inventory_widget_status, statusLabel);
                manager.updateAppWidget(widgetId, views);
            }
            finish.run();
        }, "foundr1-widget-refresh").start();
    }

    static void refreshWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, InventoryWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        if (ids.length == 0) return;
        for (int id : ids) manager.updateAppWidget(id, baseViews(context));
        refreshStatusAsync(context, manager, ids, () -> {});
    }
}
