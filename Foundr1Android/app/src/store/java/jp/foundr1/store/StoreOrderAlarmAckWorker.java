package jp.foundr1.store;

import android.content.Context;
import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;

public final class StoreOrderAlarmAckWorker extends Worker {
    public StoreOrderAlarmAckWorker(Context context, WorkerParameters parameters) { super(context, parameters); }
    static void enqueue(Context context, JSONArray ids) {
        if (ids.length() == 0) return;
        WorkManager.getInstance(context).enqueue(new OneTimeWorkRequest.Builder(StoreOrderAlarmAckWorker.class)
            .setInputData(new Data.Builder().putString("eventIds", ids.toString())
                .putString("sessionId", StoreOrderPush.prefs(context).getString("sessionId", "")).build())
            .setConstraints(StoreOrderPush.networkConstraints()).addTag("foundr1-order-alarm-ack")
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build());
    }
    @Override public Result doWork() {
        Context context = getApplicationContext();
        String session = StoreOrderPush.prefs(context).getString("sessionId", ""), secret = StoreOrderPush.prefs(context).getString("presenceToken", "");
        if (session.isEmpty() || secret.isEmpty() || !session.equals(getInputData().getString("sessionId"))) return Result.success();
        try {
            StoreOrderAlarmApi.Result result = StoreOrderAlarmApi.request(secret, "acknowledge", new JSONArray(getInputData().getString("eventIds")));
            if (!secret.equals(StoreOrderPush.prefs(context).getString("presenceToken", ""))) return Result.success();
            if (result.code == 401) { StoreOrderPush.clearBinding(context); return Result.success(); }
            if (result.code == 200) {
                if ("ALARM_ACK_PENDING".equals(StoreOrderAlarmState.error(context))) StoreOrderAlarmState.error(context, "");
                return Result.success();
            }
            if (result.code == 403 || result.code == 400) {
                StoreOrderAlarmState.error(context, "ALARM_ACK_REJECTED");
                return Result.failure();
            }
            StoreOrderAlarmState.error(context, "ALARM_ACK_PENDING");
            return Result.retry();
        } catch (Exception error) { StoreOrderAlarmState.error(context, "ALARM_ACK_PENDING"); return Result.retry(); }
    }
}
