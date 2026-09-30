package jp.foundr1.store;

import android.webkit.CookieManager;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/** Exercise the real client serialization and session guard without outbound network access. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = android.app.Application.class)
public class StoreWidgetDeviceApiTest {
    private static JSONObject response;
    private static int status = 200;
    private static Connection last;
    static class Connection extends HttpURLConnection {
        final ByteArrayOutputStream payload = new ByteArrayOutputStream();
        Connection(URL url) { super(url); }
        @Override public void connect() {}
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public int getResponseCode() { return status; }
        @Override public java.io.OutputStream getOutputStream() { return payload; }
        @Override public java.io.InputStream getInputStream() { return new ByteArrayInputStream(response.toString().getBytes(StandardCharsets.UTF_8)); }
        @Override public java.io.InputStream getErrorStream() { return getInputStream(); }
    }
    @Test public void scopedReadConfirmedCommandAndDeniedAccessUseExistingApi() throws Exception {
        URL.setURLStreamHandlerFactory(protocol -> "https".equals(protocol) ? new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL url) throws java.io.IOException {
                if (!"www.foundr1.jp".equals(url.getHost())) throw new java.io.IOException("Unexpected host");
                return last = new Connection(url);
            }
        } : null);
        String store = "ed6c3b1f-e68a-4cbd-92e2-06a800eb7183", key = "111111111111111111111111";
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=client-test");
        String session = InventoryApiClient.sessionKey();
        response = new JSONObject().put("storeId", store).put("devices", new JSONArray().put(new JSONObject()
            .put("key", key).put("sample", new JSONObject().put("lightLevel", 1))
            .put("fetchedAt", java.time.Instant.now().plusSeconds(30).toString())
            .put("_widgetRead", new JSONObject().put("process", "must-not-trust-response-metadata"))));
        JSONObject read = InventoryApiClient.loadDevices(store, key, session).getJSONArray("devices").getJSONObject(0);
        assertTrue(StoreWidgetDevicePolicy.freshForAction(read, android.os.SystemClock.elapsedRealtime()));
        assertFalse(last.getUseCaches());
        assertEquals("GET", last.getRequestMethod());
        assertEquals("/api/store/devices", last.getURL().getPath());
        assertTrue(last.getURL().getQuery().contains("device=" + key));
        assertEquals("store-widget", last.getRequestProperty("X-Foundr1-Native-Surface"));
        String id = java.util.UUID.randomUUID().toString();
        response = new JSONObject().put("command", new JSONObject().put("result", "accepted"));
        InventoryApiClient.commandDevice(store, key, "setPosition", 100, id, session);
        JSONObject body = new JSONObject(last.payload.toString("UTF-8"));
        assertEquals("POST", last.getRequestMethod()); assertEquals(store, body.getString("storeId"));
        assertEquals(key, body.getString("device")); assertEquals(id, body.getString("requestId"));
        assertEquals(100, body.getInt("position")); assertTrue(body.getBoolean("confirmed"));
        status = 403; response = new JSONObject().put("error", "denied");
        try { InventoryApiClient.loadDevices(store, key, session); fail(); } catch (InventoryApiClient.ApiException denied) { assertEquals(403, denied.status); }
        status = 200; response = new JSONObject().put("storeId", "other-store").put("devices", new JSONArray());
        try { InventoryApiClient.loadDevices(store, key, session); fail(); } catch (java.io.IOException denied) { assertEquals("Invalid device scope", denied.getMessage()); }
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=changed");
        try { InventoryApiClient.commandDevice(store, key, "press", null, id, session); fail(); }
        catch (InventoryApiClient.ApiException changed) { assertEquals(409, changed.status); assertEquals(0, last.payload.size()); }
    }
}
