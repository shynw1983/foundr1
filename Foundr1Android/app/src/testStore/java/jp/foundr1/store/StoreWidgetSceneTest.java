package jp.foundr1.store;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.Spinner;
import android.widget.TextView;
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
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.annotation.LooperMode;
import java.time.Duration;
import java.util.function.BooleanSupplier;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

/** Real activity lifecycle and background work; all server responses are local fixtures. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "ja-w360dp-h800dp-mdpi", application = android.app.Application.class)
@LooperMode(LooperMode.Mode.PAUSED)
public class StoreWidgetSceneTest {
    private static final String ID = "1efbd558-7d9b-478c-a6bf-213d8d1f08a3";
    private static final String OTHER = "5b594eac-0920-4fc2-80e2-8b208c8dc3ec";
    private static final String LIGHT = "111111111111111111111111", PLUG = "222222222222222222222222";
    private static JSONObject catalog, run;
    private static String responseStatus, sendFailure;
    private Context context;
    private String session;

    public static class RecordingActivity extends StoreWidgetSceneActivity {
        volatile int reads, writes, resultReads;
        volatile String sentId, readId;
        volatile boolean allowUnlock;
        @Override JSONObject readCatalog() { reads++; return catalog; }
        @Override JSONObject readRun(String id) { resultReads++; readId = id; return run; }
        @Override JSONObject sendScene(String id, boolean unlock) throws Exception {
            writes++; sentId = id; allowUnlock = unlock;
            if ("denied".equals(sendFailure)) throw new InventoryApiClient.ApiException(403, "denied");
            run = result(id, responseStatus);
            if ("lost".equals(sendFailure)) throw new java.io.IOException("response lost after acceptance");
            return run;
        }
    }
    public static class ConfigActivity extends InventoryWidgetConfigActivity {
        static boolean scenesUnavailable;
        @Override void loadStores() {} // Prevent configuration discovery from using a live account.
        @Override JSONObject readDeviceList(String store, String session) throws Exception {
            return new JSONObject().put("devices", new JSONArray().put(device()));
        }
        @Override JSONObject readSceneList(String store, String session) throws Exception {
            if (scenesUnavailable) throw new java.io.IOException("scene API offline");
            return catalog;
        }
    }
    private static JSONObject device() throws Exception {
        return new JSONObject().put("key", PLUG).put("name", "間接照明").put("kind", "plug").put("controlEnabled", true)
            .put("actions", new JSONArray().put("turnOn").put("turnOff"));
    }
    private static JSONObject scene() throws Exception {
        return new JSONObject().put("id", ID).put("name", "休憩モード").put("steps", new JSONArray()
            .put(new JSONObject().put("device", LIGHT).put("action", "turnOff"))
            .put(new JSONObject().put("device", PLUG).put("action", "turnOn"))
            .put(new JSONObject().put("device", "333333333333333333333333").put("action", "setPosition").put("position", 100))
            .put(new JSONObject().put("device", "444444444444444444444444").put("action", "lock")));
    }
    private static JSONObject result(String id, String status) throws Exception {
        JSONArray steps = new JSONArray(scene().getJSONArray("steps").toString());
        for (int i = 0; i < steps.length(); i++) steps.getJSONObject(i).put("name", catalog.getJSONArray("devices").getJSONObject(i).getString("name"))
            .put("status", i == 0 ? "skipped" : "running".equals(status) ? "pending" : "sent");
        steps.getJSONObject(0).put("reason", "light_below_on_range");
        return new JSONObject().put("id", id).put("sceneId", ID).put("status", status).put("steps", steps);
    }
    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        StoreWidgetDevicesData.prefs(context).edit().clear().commit();
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=widget-scene-test");
        session = InventoryApiClient.sessionKey();
        AppWidgetProviderInfo info = new AppWidgetProviderInfo(); info.provider = new ComponentName(context, InventoryWidgetProvider.class);
        shadowOf(AppWidgetManager.getInstance(context)).addBoundWidget(7, info);
        InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "store", "清水店", "", "");
        StoreWidgetDevicesData.saveSlots(context, 7, StoreWidgetScenePolicy.binding(scene()), device());
        catalog = new JSONObject().put("storeId", "store").put("revision", java.util.UUID.randomUUID().toString())
            .put("scenes", new JSONArray().put(scene())).put("devices", new JSONArray()
                .put(new JSONObject().put("key", LIGHT).put("name", "室内照明").put("kind", "indoorLight"))
                .put(new JSONObject().put("key", PLUG).put("name", "間接照明").put("kind", "plug"))
                .put(new JSONObject().put("key", "333333333333333333333333").put("name", "ロールスクリーン").put("kind", "shade"))
                .put(new JSONObject().put("key", "444444444444444444444444").put("name", "入口ドア").put("kind", "lock")));
        run = null; responseStatus = "completed"; sendFailure = ""; ConfigActivity.scenesUnavailable = false;
    }
    private Intent intent() {
        return new Intent(context, RecordingActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 7)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_STORE, "store").putExtra(StoreWidgetDeviceActivity.EXTRA_KEY, ID)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, 0).putExtra(StoreWidgetDeviceActivity.EXTRA_SESSION, session);
    }
    private static View find(View view, String text) {
        if (view instanceof TextView && ((TextView)view).getText().toString().contains(text)) return view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) {
            View result = find(((ViewGroup)view).getChildAt(i), text); if (result != null) return result;
        }
        return null;
    }
    private static View root(RecordingActivity activity) { return activity.getWindow().getDecorView(); }
    private static void await(BooleanSupplier condition) throws Exception {
        long deadline = System.nanoTime() + 3_000_000_000L;
        do { shadowOf(Looper.getMainLooper()).idle(); if (condition.getAsBoolean()) return; Thread.sleep(5); }
        while (System.nanoTime() < deadline);
        fail("Background activity did not settle");
    }
    private static void ready(RecordingActivity activity) throws Exception { await(() -> find(root(activity), "确认执行场景") != null); }

    @Test public void launchCancelAndEmptyRestorationReadOnlyAndShowCurrentScene() throws Exception {
        catalog.getJSONArray("scenes").getJSONObject(0).put("name", "午后休息");
        for (Bundle saved : new Bundle[]{null, new Bundle()}) {
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent())) {
                if (saved == null) controller.setup(); else controller.setup(saved);
                RecordingActivity a = controller.get(); ready(a);
                assertNotNull(find(root(a), "午后休息")); assertNotNull(find(root(a), "仅10–20才按"));
                assertEquals(1, a.reads); assertEquals(0, a.writes);
                find(root(a), "取消").performClick(); assertTrue(a.isFinishing());
                a.execute(); assertEquals(0, a.writes);
            }
        }
    }
    @Test public void confirmedDoubleTapHasOneRequestAndShowsSkippedLightResult() throws Exception {
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
            RecordingActivity a = controller.get(); ready(a);
            View button = find(root(a), "确认执行场景"); button.performClick(); button.performClick(); a.execute();
            await(() -> find(root(a), "执行结果") != null);
            assertEquals(1, a.writes); assertNotNull(java.util.UUID.fromString(a.sentId)); assertFalse(a.allowUnlock);
            assertNotNull(find(root(a), "已跳过")); assertNotNull(find(root(a), "照度低于10，没有按压"));
            assertNull(find(root(a), "确认执行场景")); a.execute(); assertEquals(1, a.writes);
        }
    }
    @Test public void addedScenePositionsConfirmExactlyOnceAndInvalidIndexCannotRead() throws Exception {
        for (int slot : new int[]{2, 3}) {
            JSONObject[] bindings = {device(), null, null, null}; bindings[slot] = StoreWidgetScenePolicy.binding(scene());
            StoreWidgetDevicesData.saveSlots(context, 7, bindings);
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class,
                intent().putExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, slot)).setup()) {
                RecordingActivity a = controller.get(); ready(a); assertEquals(0, a.writes);
                View confirm = find(root(a), "确认执行场景"); confirm.performClick(); confirm.performClick();
                await(() -> find(root(a), "执行结果") != null); assertEquals(1, a.writes);
            }
        }
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class,
            intent().putExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, 4)).setup()) {
            RecordingActivity a = controller.get(); await(() -> find(root(a), "打开设备页") != null);
            assertEquals(0, a.reads); assertEquals(0, a.writes);
        }
    }
    @Test public void staleChangedBindingStoreSessionAndPausedActivityCannotConfirm() throws Exception {
        for (String change : new String[]{"stale", "binding", "store", "session", "paused"}) {
            setup();
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                RecordingActivity a = controller.get(); ready(a); View confirm = find(root(a), "确认执行场景");
                if (change.equals("stale")) org.robolectric.shadows.ShadowSystemClock.advanceBy(Duration.ofMillis(30_001));
                if (change.equals("binding")) StoreWidgetDevicesData.saveSlots(context, 7, device(), null);
                if (change.equals("store")) InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "other", "别店", "", "");
                if (change.equals("session")) CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=changed");
                if (change.equals("paused")) controller.pause();
                confirm.performClick(); assertEquals(change, 0, a.writes);
            }
        }
    }
    @Test public void invalidLaunchAndDeletedSceneExposeNoCommand() throws Exception {
        for (String invalid : new String[]{"session", "deleted", "widget", "type"}) {
            setup(); Intent launch = intent();
            if (invalid.equals("session")) launch.putExtra(StoreWidgetDeviceActivity.EXTRA_SESSION, "old-session");
            if (invalid.equals("widget")) launch.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 999);
            if (invalid.equals("type")) StoreWidgetDevicesData.saveSlots(context, 7, device(), null);
            if (invalid.equals("deleted")) catalog.put("scenes", new JSONArray());
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, launch).setup()) {
                RecordingActivity a = controller.get();
                await(() -> find(root(a), "打开设备页") != null || find(root(a), "機器ページを開く") != null);
                assertNull(find(root(a), "确认执行场景")); a.execute(); assertEquals(0, a.writes);
                assertEquals(invalid.equals("deleted") ? 1 : 0, a.reads);
            }
        }
    }
    @Test public void unlockingNeedsExplicitExtraConfirmation() throws Exception {
        catalog.getJSONArray("scenes").getJSONObject(0).getJSONArray("steps").getJSONObject(3).put("action", "unlock");
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
            RecordingActivity a = controller.get(); ready(a);
            Button confirm = (Button)find(root(a), "确认执行场景"); assertFalse(confirm.isEnabled());
            a.execute(); assertEquals(0, a.writes);
            // Re-read after a rejected unconfirmed invocation, as the real UI offers.
            a.load(); ready(a); confirm = (Button)find(root(a), "确认执行场景");
            ((CheckBox)find(root(a), "将允许开门")).setChecked(true); assertTrue(confirm.isEnabled()); confirm.performClick();
            await(() -> find(root(a), "执行结果") != null); assertEquals(1, a.writes); assertTrue(a.allowUnlock);
        }
    }
    @Test public void lostResponseAndActivityRestorationOnlyReadOriginalRunId() throws Exception {
        sendFailure = "lost"; Bundle saved = new Bundle(); String id;
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
            RecordingActivity a = controller.get(); ready(a); find(root(a), "确认执行场景").performClick();
            await(() -> find(root(a), "执行结果") != null); assertEquals(1, a.writes); assertEquals(1, a.resultReads);
            assertEquals(a.sentId, a.readId); id = a.sentId; controller.saveInstanceState(saved);
        }
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup(saved)) {
            RecordingActivity a = controller.get(); await(() -> find(root(a), "执行结果") != null);
            assertEquals(id, a.readId); assertEquals(0, a.reads); assertEquals(0, a.writes);
            assertNull(find(root(a), "确认执行场景"));
        }
    }
    @Test public void definitiveDenialAndUnconfirmedResultNeverRetryAutomatically() throws Exception {
        for (String mode : new String[]{"denied", "missing", "foreign"}) {
            setup(); sendFailure = mode.equals("denied") ? mode : "lost";
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                RecordingActivity a = controller.get(); ready(a); find(root(a), "确认执行场景").performClick();
                await(() -> find(root(a), mode.equals("denied") ? "打开设备页" : "执行结果") != null);
                if (!mode.equals("denied")) {
                    run = mode.equals("missing") ? null : result(java.util.UUID.randomUUID().toString(), "completed");
                    a.load(); await(() -> find(root(a), "结果未确认") != null);
                }
                shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(4));
                assertEquals(1, a.writes); assertNull(find(root(a), "确认执行场景"));
            }
        }
    }
    @Test public void observationIsBoundedAndStopsWhenWindowCloses() throws Exception {
        responseStatus = "running";
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
            RecordingActivity a = controller.get(); ready(a); find(root(a), "确认执行场景").performClick();
            await(() -> find(root(a), "读取结果") != null);
            assertEquals(0, a.resultReads); shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(5));
            await(() -> a.resultReads == 1 && find(root(a), "读取结果") != null);
            controller.pause(); shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(20));
            assertEquals(1, a.resultReads);
            controller.resume(); await(() -> a.resultReads == 2 && find(root(a), "读取结果") != null);
            org.robolectric.shadows.ShadowSystemClock.advanceBy(Duration.ofMinutes(4));
            shadowOf(Looper.getMainLooper()).idle(); await(() -> find(root(a), "自动检查已停止") != null);
            int count = a.resultReads; shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(4));
            assertEquals(count, a.resultReads); assertEquals(1, a.writes);
        }
    }
    @Test public void anotherRunningSceneAndCatalogDoNotStartIdlePolling() throws Exception {
        catalog.put("latestRun", result(java.util.UUID.randomUUID().toString(), "running").put("sceneId", OTHER));
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
            RecordingActivity a = controller.get(); await(() -> find(root(a), "本店的其他场景正在执行") != null);
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(4));
            assertEquals(1, a.reads); assertEquals(0, a.resultReads); assertEquals(0, a.writes);
        }
    }
    private static void spinners(View view, java.util.List<Spinner> output) {
        if (view instanceof Spinner) output.add((Spinner)view);
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) spinners(((ViewGroup)view).getChildAt(i), output);
    }
    @Test public void configurationListsBothTypesAndPreservesSceneDuringPartialFailure() throws Exception {
        try (ActivityController<ConfigActivity> controller = Robolectric.buildActivity(ConfigActivity.class,
            new Intent(context, ConfigActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 7)).setup()) {
            ConfigActivity a = controller.get(); a.loadDevices("store");
            java.util.List<Spinner> list = new java.util.ArrayList<>(); spinners(a.getWindow().getDecorView(), list);
            Spinner first = list.get(list.size() - 4), second = list.get(list.size() - 3);
            await(() -> first.isEnabled() && first.getCount() == 3);
            assertTrue(first.getSelectedItem().toString().contains("休息模式"));
            assertTrue(second.getSelectedItem().toString().contains("間接照明"));
            first.setSelection(1); shadowOf(Looper.getMainLooper()).idle();
            a.loadDevices("store"); await(() -> first.isEnabled() && first.getCount() == 3);
            assertTrue("Refreshing must retain unsaved selection", first.getSelectedItem().toString().contains("間接照明"));
            ConfigActivity.scenesUnavailable = true; a.loadDevices("store");
            await(() -> first.isEnabled() && find(a.getWindow().getDecorView(), "部分清单读取失败") != null);
            assertEquals(3, first.getCount()); assertTrue(first.getItemAtPosition(2).toString().contains("休息模式"));
            assertTrue(StoreWidgetScenePolicy.isScene(StoreWidgetDevicesData.slot(context, 7, 0)));
        }
    }
    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void fourSelectorsPreserveAllSavedTargetsRejectDuplicatesAndKeepControlsReachable() throws Exception {
        JSONObject afternoon = new JSONObject(scene().toString()).put("id", OTHER).put("name", "午後休憩");
        JSONObject closing = new JSONObject(scene().toString()).put("id", "2d306676-a5fb-491a-a6bb-e7206f042229").put("name", "閉店");
        catalog.getJSONArray("scenes").put(afternoon).put(closing);
        StoreWidgetDevicesData.saveSlots(context, 7, StoreWidgetScenePolicy.binding(scene()), device(),
            StoreWidgetScenePolicy.binding(afternoon), StoreWidgetScenePolicy.binding(closing));
        try (ActivityController<ConfigActivity> controller = Robolectric.buildActivity(ConfigActivity.class,
            new Intent(context, ConfigActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 7)).setup().visible()) {
            ConfigActivity a = controller.get(); a.loadDevices("store");
            java.util.List<Spinner> list = new java.util.ArrayList<>(); spinners(a.getWindow().getDecorView(), list);
            Spinner[] slots = list.subList(list.size() - 4, list.size()).toArray(new Spinner[0]);
            await(() -> slots[0].isEnabled() && slots[0].getCount() == 5);
            String[] labels = {"休息模式", "間接照明", "午後休憩", "閉店"};
            for (int slot = 0; slot < 4; slot++) assertTrue(slots[slot].getSelectedItem().toString().contains(labels[slot]));
            slots[2].setSelection(slots[0].getSelectedItemPosition()); shadowOf(Looper.getMainLooper()).idle();
            assertNotNull(find(a.getWindow().getDecorView(), "请选择不同的设备或场景"));
            slots[2].setSelection(3); shadowOf(Looper.getMainLooper()).idle();
            ConfigActivity.scenesUnavailable = true; a.loadDevices("store");
            await(() -> slots[0].isEnabled() && find(a.getWindow().getDecorView(), "部分清单读取失败") != null);
            for (int slot = 0; slot < 4; slot++) assertTrue(slots[slot].getSelectedItem().toString().contains(labels[slot]));
            ViewGroup content = a.findViewById(android.R.id.content);
            content.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
            content.layout(0, 0, 360, 800);
            ((android.widget.ScrollView)content.getChildAt(0)).fullScroll(View.FOCUS_DOWN);
            Button save = (Button)find(content, "保存 / 保存する");
            android.graphics.Rect bounds = new android.graphics.Rect(); save.getDrawingRect(bounds); content.offsetDescendantRectToMyCoords(save, bounds);
            assertTrue(new android.graphics.Rect(0, 0, 360, 800).contains(bounds)); assertTrue(bounds.height() >= 48);
        }
    }
    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void confirmationRendersAtPhoneTabletAndUnfoldedSizes() throws Exception {
        for (int width : new int[]{360, 600, 720}) for (String language : new String[]{"ja", "zh"}) {
            RuntimeEnvironment.setQualifiers("ja-w" + width + "dp-h800dp-mdpi");
            InventoryWidgetProvider.saveConfiguration(context, 7, language, "store", "清水店", "", "");
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup().visible()) {
                RecordingActivity a = controller.get(); await(() -> find(root(a), language.equals("ja") ? "確認して実行" : "确认执行场景") != null);
                ViewGroup content = a.findViewById(android.R.id.content);
                content.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
                content.layout(0, 0, width, 800);
                Button confirm = (Button)find(content, language.equals("ja") ? "確認して実行" : "确认执行场景");
                assertTrue(confirm.isShown()); assertTrue(confirm.isEnabled()); assertTrue(confirm.getHeight() >= 48);
                android.graphics.Rect bounds = new android.graphics.Rect(); confirm.getDrawingRect(bounds); content.offsetDescendantRectToMyCoords(confirm, bounds);
                assertTrue(new android.graphics.Rect(0, 0, width, 800).contains(bounds)); assertEquals(0, a.writes);
                String output = System.getenv("FOUNDR1_WIDGET_PREVIEW_DIR");
                if (output != null) {
                    java.io.File directory = new java.io.File(output); directory.mkdirs();
                    android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(width, 800, android.graphics.Bitmap.Config.ARGB_8888);
                    android.graphics.Canvas canvas = new android.graphics.Canvas(bitmap); canvas.drawColor(0xFFD9DED8); content.draw(canvas);
                    try (java.io.FileOutputStream file = new java.io.FileOutputStream(new java.io.File(directory, "scene-confirmation-" + language + "-" + width + ".png"))) {
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, file);
                    }
                    bitmap.recycle();
                }
            }
        }
    }
    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void longUnlockSceneAtLargeFontKeepsConfirmationReachableByScrolling() throws Exception {
        android.content.res.Configuration config = new android.content.res.Configuration(context.getResources().getConfiguration());
        config.fontScale = 1.3f;
        context.getResources().updateConfiguration(config, context.getResources().getDisplayMetrics());
        catalog.getJSONArray("scenes").getJSONObject(0).put("name", "照明、卷帘和入口的营业准备")
            .getJSONArray("steps").getJSONObject(3).put("action", "unlock");
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup().visible()) {
            RecordingActivity a = controller.get(); ready(a);
            ViewGroup content = a.findViewById(android.R.id.content);
            content.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
            content.layout(0, 0, 360, 800);
            Button confirm = (Button)find(content, "确认执行场景");
            android.widget.ScrollView scroll = (android.widget.ScrollView)confirm.getParent().getParent();
            scroll.fullScroll(View.FOCUS_DOWN);
            android.graphics.Rect bounds = new android.graphics.Rect(); confirm.getDrawingRect(bounds); content.offsetDescendantRectToMyCoords(confirm, bounds);
            assertTrue(new android.graphics.Rect(0, 0, 360, 800).contains(bounds));
            assertTrue(confirm.getHeight() >= 48); assertFalse(confirm.isEnabled()); assertEquals(0, a.writes);
        } finally { config.fontScale = 1f; context.getResources().updateConfiguration(config, context.getResources().getDisplayMetrics()); }
    }
}
