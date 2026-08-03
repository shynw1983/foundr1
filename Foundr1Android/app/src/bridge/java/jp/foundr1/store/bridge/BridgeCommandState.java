package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONObject;

final class BridgeCommandState {
    static final String ACTION_COMMAND_AVAILABLE = "jp.foundr1.bridge.COMMAND_AVAILABLE";
    private static final String PREFS = "foundr1_bridge_command";
    private static final String KEY_COMMAND = "command";

    private BridgeCommandState() {}

    static void receive(Context context, JSONObject command) {
        if (command == null || command.optString("id").trim().isEmpty()) return;
        JSONObject current = current(context);
        if (
            current != null
            && !current.optString("id").equals(command.optString("id"))
        ) return;
        preferences(context).edit().putString(KEY_COMMAND, command.toString()).apply();
        Intent intent = new Intent(ACTION_COMMAND_AVAILABLE);
        intent.setPackage(context.getPackageName());
        context.sendBroadcast(intent);
    }

    static JSONObject current(Context context) {
        try {
            String value = preferences(context).getString(KEY_COMMAND, "");
            return value == null || value.trim().isEmpty() ? null : new JSONObject(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    static void complete(Context context, String resultStatus) {
        complete(context, resultStatus, null);
    }

    static void complete(Context context, String resultStatus, JSONObject resultDetails) {
        JSONObject command = current(context);
        if (command == null) return;
        preferences(context).edit().remove(KEY_COMMAND).apply();
        try {
            JSONObject result = resultDetails == null ? new JSONObject() : resultDetails;
            result.put("outcome", resultStatus);
            BridgeCommandClient.acknowledge(
                context,
                command.optString("id"),
                "succeeded",
                "",
                result
            );
        } catch (Exception ignored) {
        }
    }

    static void fail(Context context, String error) {
        JSONObject command = current(context);
        if (command == null) return;
        preferences(context).edit().remove(KEY_COMMAND).apply();
        BridgeCommandClient.acknowledge(
            context,
            command.optString("id"),
            "failed",
            error,
            new JSONObject()
        );
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
