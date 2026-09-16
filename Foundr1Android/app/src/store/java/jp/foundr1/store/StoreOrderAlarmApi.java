package jp.foundr1.store;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

final class StoreOrderAlarmApi {
    static final class Result {
        final int code; final JSONObject body;
        Result(int code, JSONObject body) { this.code = code; this.body = body; }
    }
    static Result request(String secret, String action, JSONArray eventIds) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("https://www.foundr1.jp/api/store/order-notifications/alarm").openConnection();
        try {
            connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + secret);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] body = new JSONObject().put("action", action).put("eventIds", eventIds).toString().getBytes(StandardCharsets.UTF_8);
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
            int code = connection.getResponseCode();
            if (code != 200) return new Result(code, new JSONObject());
            StringBuilder text = new StringBuilder();
            try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line; while ((line = reader.readLine()) != null) { text.append(line); if (text.length() > 65536) throw new IllegalStateException("Response too large"); }
            }
            return new Result(code, new JSONObject(text.toString()));
        } finally { connection.disconnect(); }
    }
}
