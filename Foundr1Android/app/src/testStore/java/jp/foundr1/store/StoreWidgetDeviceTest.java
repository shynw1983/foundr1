package jp.foundr1.store;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.widget.Button;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = android.app.Application.class)
public class StoreWidgetDeviceTest {
    private static final String KEY = "111111111111111111111111", OTHER = "222222222222222222222222";
    private Context context;
    private String session;
    private static JSONObject fixture;
    public static class RecordingActivity extends StoreWidgetDeviceActivity {
        int reads;
        volatile int writes;
        volatile String action, requestId;
        final java.util.concurrent.CountDownLatch sent = new java.util.concurrent.CountDownLatch(1);
        @Override void load() { reads++; showDevice(fixture); }
        @Override JSONObject sendCommand(String action, Integer position, String requestId) throws Exception {
            writes++; this.action = action; this.requestId = requestId; sent.countDown();
            return new JSONObject().put("command", new JSONObject().put("result", "accepted"));
        }
    }
    private JSONObject device(String key) throws Exception {
        JSONObject result = new JSONObject().put("key", key).put("name", "間接照明").put("kind", "plug").put("controlEnabled", true)
            .put("actions", new JSONArray().put("turnOn").put("turnOff"))
            .put("fetchedAt", java.time.Instant.now().toString()).put("sample", new JSONObject().put("power", "on"));
        long now = android.os.SystemClock.elapsedRealtime();
        StoreWidgetDevicePolicy.recordRead(result, now, now);
        return result;
    }
    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        StoreWidgetDevicesData.prefs(context).edit().clear().commit();
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=widget-device-test");
        session = InventoryApiClient.sessionKey();
        AppWidgetProviderInfo info = new AppWidgetProviderInfo(); info.provider = new ComponentName(context, InventoryWidgetProvider.class);
        shadowOf(AppWidgetManager.getInstance(context)).addBoundWidget(7, info);
        InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "store", "清水店", "", "");
        fixture = device(KEY);
        StoreWidgetDevicesData.saveSlots(context, 7, fixture, device(OTHER));
    }
    private Intent intent() {
        return new Intent(context, RecordingActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 7)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_STORE, "store").putExtra(StoreWidgetDeviceActivity.EXTRA_KEY, KEY)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, 0).putExtra(StoreWidgetDeviceActivity.EXTRA_SESSION, session);
    }
    private Button find(View view, String label) {
        if (view instanceof Button && label.contentEquals(((Button)view).getText())) return (Button)view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) {
            Button result = find(((ViewGroup)view).getChildAt(i), label); if (result != null) return result;
        }
        return null;
    }
    @Test public void launcherAndRestorationReadFreshWithoutSendingAndCancelDoesNothing() {
        for (Bundle saved : new Bundle[]{null, new Bundle()}) {
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent())) {
                if (saved == null) controller.setup(); else controller.setup(saved);
                RecordingActivity activity = controller.get();
                assertEquals(1, activity.reads); assertEquals(0, activity.writes);
                assertNotNull(find(activity.getWindow().getDecorView(), "确认关闭"));
                find(activity.getWindow().getDecorView(), "取消").performClick();
                assertTrue(activity.isFinishing()); assertEquals(0, activity.writes);
            }
        }
    }
    @Test public void explicitConfirmationSendsExactlyOnceAndUsesUniqueId() throws Exception {
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
            RecordingActivity activity = controller.get();
            Button button = find(activity.getWindow().getDecorView(), "确认关闭");
            button.performClick(); button.performClick(); activity.execute("turnOn", null);
            assertTrue(activity.sent.await(3, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(1, activity.writes); assertEquals("turnOff", activity.action);
            assertNotNull(java.util.UUID.fromString(activity.requestId));
        }
    }
    @Test public void addedSlotsReadTheirOwnDeviceAndOnlyExplicitlyConfirm() throws Exception {
        String[] keys = {KEY, OTHER, "333333333333333333333333", "444444444444444444444444"};
        for (int slot : new int[]{2, 3}) {
            JSONObject[] bindings = new JSONObject[4];
            for (int i = 0; i < 4; i++) bindings[i] = device(keys[i]);
            fixture = bindings[slot]; StoreWidgetDevicesData.saveSlots(context, 7, bindings);
            Intent launch = intent().putExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, slot).putExtra(StoreWidgetDeviceActivity.EXTRA_KEY, keys[slot]);
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, launch).setup()) {
                RecordingActivity a = controller.get(); assertEquals(1, a.reads); assertEquals(0, a.writes);
                find(a.getWindow().getDecorView(), "确认关闭").performClick();
                assertTrue(a.sent.await(3, java.util.concurrent.TimeUnit.SECONDS)); assertEquals(1, a.writes);
            }
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, launch).setup()) {
                RecordingActivity a = controller.get(); Button confirm = find(a.getWindow().getDecorView(), "确认关闭");
                bindings[slot] = device(KEY); StoreWidgetDevicesData.saveSlots(context, 7, bindings);
                confirm.performClick(); assertEquals(0, a.writes);
            }
        }
    }
    @Test public void oldTwoBindingsUpgradeAndFourSlotsStayScopedThroughStoreBrandAndDeletion() throws Exception {
        JSONObject old = StoreWidgetDevicesData.slot(context, 7, 0); old.remove("targetType");
        StoreWidgetDevicesData.prefs(context).edit().putString("slot:7:0", old.toString()).commit();
        assertEquals(KEY, StoreWidgetDevicesData.slot(context, 7, 0).getString("key"));
        assertEquals(OTHER, StoreWidgetDevicesData.slot(context, 7, 1).getString("key"));
        assertEquals("", StoreWidgetDevicesData.slot(context, 7, 2).optString("key"));
        assertEquals("", StoreWidgetDevicesData.slot(context, 7, 3).optString("key"));
        JSONObject scene = StoreWidgetScenePolicy.binding(new JSONObject().put("id", "1efbd558-7d9b-478c-a6bf-213d8d1f08a3").put("name", "休憩モード"));
        StoreWidgetDevicesData.saveSlots(context, 7, old, device(OTHER), scene, device("444444444444444444444444"));
        InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "store", "清水店", "brand", "まぁ麻");
        assertEquals(KEY, StoreWidgetDevicesData.slot(context, 7, 0).getString("key"));
        assertEquals(OTHER, StoreWidgetDevicesData.slot(context, 7, 1).getString("key"));
        assertTrue(StoreWidgetScenePolicy.isScene(StoreWidgetDevicesData.slot(context, 7, 2)));
        assertEquals("444444444444444444444444", StoreWidgetDevicesData.slot(context, 7, 3).getString("key"));
        InventoryWidgetProvider.saveConfiguration(context, 8, "ja", "store", "清水店", "", "");
        StoreWidgetDevicesData.saveSlots(context, 8, old, device(OTHER), scene, device("444444444444444444444444"));
        InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "other", "别店", "", "");
        for (int slot = 0; slot < 4; slot++) {
            assertEquals("", StoreWidgetDevicesData.slot(context, 7, slot).optString("key"));
            assertFalse(StoreWidgetDevicesData.slot(context, 8, slot).optString("key").isEmpty());
        }
        new InventoryWidgetProvider().onDeleted(context, new int[]{8});
        for (int slot = 0; slot < 4; slot++) assertEquals("", StoreWidgetDevicesData.slot(context, 8, slot).optString("key"));
    }
    @Test public void freshIndoorLightReadAllowsConfirmationWhenPhoneClockDiffers() throws Exception {
        for (long skewSeconds : new long[]{30, -300, 86_400, -86_400}) {
            fixture = device(KEY).put("name", "室内照明").put("kind", "indoorLight")
                .put("actions", new JSONArray().put("press"))
                .put("sample", new JSONObject().put("botMode", "pressMode").put("lightLevel", 1))
                .put("fetchedAt", java.time.Instant.now().plusSeconds(skewSeconds).toString());
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                RecordingActivity activity = controller.get();
                assertEquals("灭（推测）", StoreWidgetDevicePolicy.state(fixture, true));
                Button confirm = find(activity.getWindow().getDecorView(), "确认按一下");
                assertNotNull("Clock offset " + skewSeconds + " must not hide the action", confirm);
                assertEquals(0, activity.writes);
                confirm.performClick();
                assertTrue(activity.sent.await(3, java.util.concurrent.TimeUnit.SECONDS));
                assertEquals(1, activity.writes); assertEquals("press", activity.action);
            }
        }
    }
    @Test public void changedAccountStoreAndSlotCannotUseOldShortcutOrConfirmation() throws Exception {
        for (String change : new String[]{"slot", "store", "account"}) {
            setup();
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                RecordingActivity activity = controller.get();
                Button button = find(activity.getWindow().getDecorView(), "确认关闭");
                if (change.equals("slot")) StoreWidgetDevicesData.saveSlots(context, 7, device(OTHER), null);
                if (change.equals("store")) InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "other", "别店", "", "");
                if (change.equals("account")) CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=another-account");
                button.performClick(); assertEquals(0, activity.writes);
            }
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                assertEquals(0, controller.get().reads); assertEquals(0, controller.get().writes);
            }
        }
    }
    @Test public void unconfirmedStatesDisabledControlAndCooldownExposeNoPhysicalAction() throws Exception {
        for (String failure : new String[]{"stale", "read", "disabled", "cooldown"}) {
            fixture = device(KEY);
            if (failure.equals("stale")) fixture.remove("_widgetRead");
            if (failure.equals("read")) fixture.put("readError", true);
            if (failure.equals("disabled")) fixture.put("controlEnabled", false);
            if (failure.equals("cooldown")) fixture.put("blockedUntil", java.time.Instant.now().plusSeconds(10).toString());
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                assertNull(failure, find(controller.get().getWindow().getDecorView(), "确认关闭"));
                controller.get().execute("turnOff", null); assertEquals(0, controller.get().writes);
            }
        }
    }
    @Test public void confirmationExpiresByElapsedTimeAndCannotSendAfterWaiting() throws Exception {
        fixture.put("fetchedAt", java.time.Instant.now().plusSeconds(86_400).toString());
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
            RecordingActivity activity = controller.get();
            Button confirm = find(activity.getWindow().getDecorView(), "确认关闭");
            assertNotNull(confirm);
            org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofMillis(30_001));
            confirm.performClick();
            assertEquals(0, activity.writes);
            assertNotNull(find(activity.getWindow().getDecorView(), "重新读取"));
            activity.showDevice(fixture);
            assertNull(find(activity.getWindow().getDecorView(), "确认关闭"));
        }
    }
    @Test public void serverCooldownRemainsTenSecondsRegardlessOfPhoneClock() throws Exception {
        for (long skew : new long[]{-86_400, 86_400}) {
            fixture = device(KEY);
            java.time.Instant server = java.time.Instant.now().plusSeconds(skew);
            fixture.put("fetchedAt", server.toString()).put("blockedUntil", server.plusSeconds(10).toString());
            long received = android.os.SystemClock.elapsedRealtime();
            assertEquals(10_000, StoreWidgetDevicePolicy.cooldownRemaining(fixture, received));
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                RecordingActivity activity = controller.get();
                assertNull(find(activity.getWindow().getDecorView(), "确认关闭"));
                activity.execute("turnOff", null); assertEquals(0, activity.writes);
                org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofMillis(
                    received + 9_999 - android.os.SystemClock.elapsedRealtime()));
                assertEquals(1, StoreWidgetDevicePolicy.cooldownRemaining(fixture, received + 9_999));
                activity.showDevice(fixture);
                assertNull(find(activity.getWindow().getDecorView(), "确认关闭"));
                org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofMillis(1));
                activity.showDevice(fixture);
                Button confirm = find(activity.getWindow().getDecorView(), "确认关闭");
                assertNotNull(confirm); confirm.performClick();
                assertTrue(activity.sent.await(3, java.util.concurrent.TimeUnit.SECONDS));
                assertEquals(1, activity.writes);
            }
        }
    }
    @Test public void networkTimeAndCachedSnapshotExpiryCannotBeResetByWallClock() throws Exception {
        long start = android.os.SystemClock.elapsedRealtime();
        StoreWidgetDevicePolicy.recordRead(fixture, start, start + 30_001);
        assertFalse(StoreWidgetDevicePolicy.freshForAction(fixture, start + 30_001));
        assertTrue(StoreWidgetDevicePolicy.fresh(fixture, start + 120_000));
        assertFalse(StoreWidgetDevicePolicy.fresh(fixture, start + 120_001));
        assertFalse(StoreWidgetDevicePolicy.fresh(fixture, start - 1));
        fixture.getJSONObject("_widgetRead").put("process", "old-process-before-reboot");
        assertFalse(StoreWidgetDevicePolicy.fresh(fixture, start + 30_001));
        fixture.remove("_widgetRead");
        assertFalse(StoreWidgetDevicePolicy.fresh(fixture, start));
    }
    @Test @Config(qualifiers = "ja-w360dp-h800dp-mdpi")
    @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    public void indoorLightConfirmationIsVisibleAtPhoneAndUnfoldedSizes() throws Exception {
        for (int width : new int[]{360, 720}) for (String language : new String[]{"ja", "zh"}) {
            RuntimeEnvironment.setQualifiers("ja-w" + width + "dp-h800dp-mdpi");
            InventoryWidgetProvider.saveConfiguration(context, 7, language, "store", "清水店", "", "");
            fixture = device(KEY).put("name", "室内照明").put("kind", "indoorLight")
                .put("actions", new JSONArray().put("press"))
                .put("sample", new JSONObject().put("botMode", "pressMode").put("lightLevel", 1))
                .put("fetchedAt", java.time.Instant.now().plusSeconds(30).toString());
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup().visible()) {
                ViewGroup root = controller.get().findViewById(android.R.id.content);
                root.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
                root.layout(0, 0, width, 800);
                Button confirm = find(root, language.equals("ja") ? "スイッチを押す" : "确认按一下");
                assertNotNull(confirm); assertTrue(confirm.isShown()); assertTrue(confirm.isEnabled());
                android.graphics.Rect bounds = new android.graphics.Rect();
                confirm.getDrawingRect(bounds); root.offsetDescendantRectToMyCoords(confirm, bounds);
                assertTrue(new android.graphics.Rect(0, 0, width, 800).contains(bounds));
                assertTrue(bounds.height() >= 48); assertEquals(0, controller.get().writes);
                String output = System.getenv("FOUNDR1_WIDGET_PREVIEW_DIR");
                if (output != null) {
                    java.io.File directory = new java.io.File(output); directory.mkdirs();
                    android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(width, 800, android.graphics.Bitmap.Config.ARGB_8888);
                    android.graphics.Canvas canvas = new android.graphics.Canvas(bitmap);
                    canvas.drawColor(0xFFD9DED8); root.draw(canvas);
                    try (java.io.FileOutputStream file = new java.io.FileOutputStream(new java.io.File(directory,
                        "device-confirmation-" + language + "-" + width + ".png"))) {
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, file);
                    }
                    bitmap.recycle();
                }
            }
        }
    }
    @Test public void cacheIsAccountScopedAndDelayedReadCannotRestoreInvalidatedState() throws Exception {
        long old = StoreWidgetDevicesData.beginRead(session, "store", KEY);
        StoreWidgetDevicesData.invalidate(context, session, "store", KEY);
        StoreWidgetDevicesData.save(context, session, "store", KEY, old, fixture);
        assertNull(StoreWidgetDevicesData.read(context, "store", KEY));
        long current = StoreWidgetDevicesData.beginRead(session, "store", KEY);
        StoreWidgetDevicesData.save(context, session, "store", KEY, current, fixture);
        StoreWidgetDevicesData.failedRead(context, session, "store", KEY, old);
        assertEquals("on", StoreWidgetDevicesData.read(context, "store", KEY).getJSONObject("sample").getString("power"));
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=another-account");
        assertNull(StoreWidgetDevicesData.read(context, "store", KEY));
        StoreWidgetDevicesData.save(context, session, "store", KEY, current, fixture);
        assertNull(StoreWidgetDevicesData.read(context, "store", KEY));
    }
    @Test public void storeChangeAndRemovalClearOnlyTheirWidgetBindings() throws Exception {
        InventoryWidgetProvider.saveConfiguration(context, 8, "ja", "store", "清水店", "", "");
        StoreWidgetDevicesData.saveSlots(context, 8, fixture, null);
        InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "other", "别店", "", "");
        assertEquals("", StoreWidgetDevicesData.slot(context, 7, 0).optString("key"));
        assertEquals(KEY, StoreWidgetDevicesData.slot(context, 8, 0).optString("key"));
        new InventoryWidgetProvider().onDeleted(context, new int[]{8});
        assertEquals("", StoreWidgetDevicesData.slot(context, 8, 0).optString("key"));
    }
    @Test public void deviceIdentitySurvivesClearedStatusAndUpgradesExistingBindingsLocally() throws Exception {
        fixture.put("name", "入口").put("kind", "lock");
        StoreWidgetDevicesData.saveSlots(context, 7, fixture, null);
        StoreWidgetDevicesData.invalidate(context, session, "store", KEY);
        assertEquals(R.drawable.inventory_widget_device_lock, StoreWidgetDevicesRenderer.icon(StoreWidgetDevicesData.slot(context, 7, 0), null));

        JSONObject oldBinding = StoreWidgetDevicesData.slot(context, 7, 0);
        oldBinding.remove("kind");
        StoreWidgetDevicesData.prefs(context).edit().putString("slot:7:0", oldBinding.toString()).commit();
        fixture.put("fetchedAt", "2020-01-01T00:00:00Z");
        fixture.remove("_widgetRead");
        StoreWidgetDevicesData.save(context, session, "store", KEY, StoreWidgetDevicesData.beginRead(session, "store", KEY), fixture);
        assertFalse(StoreWidgetDevicePolicy.fresh(fixture, android.os.SystemClock.elapsedRealtime()));
        assertEquals("lock", StoreWidgetDevicesData.slot(context, 7, 0).optString("kind"));
        StoreWidgetDevicesData.invalidate(context, session, "store", KEY);
        assertEquals(R.drawable.inventory_widget_device_lock, StoreWidgetDevicesRenderer.icon(StoreWidgetDevicesData.slot(context, 7, 0), null));
        assertEquals(KEY, StoreWidgetDevicesData.slot(context, 7, 0).optString("key"));
        assertNull(StoreWidgetDevicesData.read(context, "store", KEY));
    }
    @Test public void botsNeverInventPowerAndReadOnlySensorsCannotBeSelected() throws Exception {
        fixture.put("kind", "bot").put("actions", new JSONArray().put("press")).put("sample", new JSONObject().put("botMode", "pressMode"));
        assertEquals("状态不可读", StoreWidgetDevicePolicy.state(fixture, true));
        fixture.put("kind", "indoorLight").getJSONObject("sample").put("lightLevel", 12);
        assertEquals("亮（推测）", StoreWidgetDevicePolicy.state(fixture, true));
        fixture.getJSONObject("sample").put("lightLevel", 6);
        assertEquals("状態不明", StoreWidgetDevicePolicy.state(fixture, false));
        fixture.put("actions", new JSONArray()); assertFalse(StoreWidgetDevicePolicy.selectable(fixture));
    }
}
