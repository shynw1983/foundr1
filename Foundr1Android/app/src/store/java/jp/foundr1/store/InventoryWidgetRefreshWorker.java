package jp.foundr1.store;

import android.content.Context;
import androidx.work.BackoffPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/** Durable, bounded follow-up reads; no network work inside a broadcast receiver. */
public class InventoryWidgetRefreshWorker extends Worker {
    private static final String WORK_NAME = "inventory-widget-refresh";

    public InventoryWidgetRefreshWorker(Context context, WorkerParameters parameters) { super(context, parameters); }

    static void enqueue(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(InventoryWidgetRefreshWorker.class)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS).build();
        // A newer user action must restart the read, including when an older retry is delayed.
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request);
    }

    @Override public Result doWork() {
        Context context = getApplicationContext();
        Set<String> stores = new HashSet<>();
        for (int id : InventoryWidgetProvider.widgetIds(context)) {
            String store = InventoryWidgetProvider.storeId(context, id);
            if (!store.isEmpty()) stores.add(store);
        }
        for (String store : stores) {
            if (isStopped()) return Result.success();
            boolean refreshInventory = getRunAttemptCount() == 0
                || !InventoryWidgetPolicy.fresh(InventoryApiClient.cacheCheckedAt(context, store), System.currentTimeMillis());
            InventoryWidgetData.refreshStore(context, store, refreshInventory, this::isStopped);
            if (!isStopped()) StoreWidgetControlsData.refresh(context, store, this::isStopped);
        }
        if (isStopped()) return Result.success();
        boolean pending = false;
        for (int id : InventoryWidgetProvider.widgetIds(context)) {
            InventoryWidgetProvider.renderWidget(context, id);
            InventoryWidgetData data = InventoryWidgetData.read(context, id);
            if (!InventoryWidgetData.denied(data.inventoryError) && !InventoryWidgetData.denied(data.syncError)) {
                pending |= data.pending() || "network".equals(data.inventoryError) || "network".equals(data.syncError);
            }
        }
        return pending && getRunAttemptCount() < 6 ? Result.retry() : Result.success();
    }
}
