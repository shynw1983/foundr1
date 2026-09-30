package jp.foundr1.store;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.appwidget.AppWidgetManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.ImageView;
import android.widget.RemoteViews;
import android.util.SizeF;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.Before;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import static org.robolectric.Shadows.shadowOf;

/** Host-side RemoteViews rendering: no phone, account, network, or inventory mutations. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "ja-xhdpi", application = android.app.Application.class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class InventoryWidgetLayoutTest {
    private float fontScale = 1f;
    private boolean responsive;
    private boolean accessDevices;
    private boolean sceneShortcuts;
    @Before public void controls() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        android.webkit.CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=layout-test");
        String session = InventoryApiClient.sessionKey();
        StoreWidgetControlsData.save(context, "store", session, "reception", new JSONObject().put("acceptanceMode", "auto"));
        StoreWidgetControlsData.save(context, "store", session, "away", new JSONObject().put("ready", true).put("canManage", true)
            .put("deliveryReady", true).put("sessionId", "layout-session").put("preference", new JSONObject()
                .put("enabled", false).put("exitRadius", 500).put("enterRadius", 300).put("version", "version")));
        StoreWidgetDevicesData.prefs(context).edit().clear().commit();
    }
    private InventoryWidgetData sample() throws Exception {
        InventoryWidgetData data = new InventoryWidgetData();
        data.hasInventory = true;
        data.inventoryCheckedAt = data.syncCheckedAt = System.currentTimeMillis();
        String[] names = {"【❄極冷❄】牛肉スライス（50g）", "【厳選牛】とろとろ国産牛すじ（1人前約50g）", "香り豊かな青梗菜", "新鮮きくらげ"};
        for (int i = 0; i < 57; i++) data.shortages.add(new JSONObject()
            .put("targetId", "e94830d7-605a-4cbd-9a12-0a645a93e9d8").put("targetKind", "option")
            .put("brandId", "brand").put("brandName", "まぁ麻").put("ingredientLabel", names[i % names.length])
            .put("displayNames", new JSONObject().put("zh", i == 0 ? "精选肥牛片（50g）" : "软糯国产牛筋（约50g）")));
        JSONArray platforms = new JSONArray();
        for (String platform : new String[]{"foundr1", "uber_eats", "rocket_now", "demae_can"})
            platforms.put(new JSONObject().put("platform", platform).put("total", 2).put("succeeded", 2));
        data.latestRun = new JSONObject().put("itemName", names[1]).put("action", "unavailable").put("platforms", platforms);
        return data;
    }

    private View render(String name, int width, int height, String language, InventoryWidgetData data) throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        android.content.res.Configuration configuration = new android.content.res.Configuration(context.getResources().getConfiguration());
        configuration.fontScale = fontScale;
        context = context.createConfigurationContext(configuration);
        InventoryWidgetProvider.saveConfiguration(context, 7, language, "store", "清水店", "brand", "まぁ麻");
        if (!name.contains("empty")) {
            JSONObject light = new JSONObject().put("key", "111111111111111111111111").put("name", "室内照明").put("kind", "indoorLight")
                .put("actions", new JSONArray().put("press")).put("fetchedAt", java.time.Instant.now().toString())
                .put("sample", new JSONObject().put("lightLevel", 12).put("botMode", "pressMode"));
            JSONObject plug = new JSONObject().put("key", "222222222222222222222222").put("name", "間接照明").put("kind", "plug")
                .put("actions", new JSONArray().put("turnOn").put("turnOff")).put("fetchedAt", java.time.Instant.now().toString()).put("sample", new JSONObject().put("power", "on"));
            if (accessDevices) {
                light.put("name", "入口ドア").put("kind", "lock").put("actions", new JSONArray().put("lock").put("unlock"));
                plug.put("name", "ロールスクリーン").put("kind", "shade").put("actions", new JSONArray().put("setPosition"));
            }
            if (sceneShortcuts) {
                light = StoreWidgetScenePolicy.binding(new JSONObject().put("id", "1efbd558-7d9b-478c-a6bf-213d8d1f08a3").put("name", "休憩モード").put("icon", "bed"));
                plug = StoreWidgetScenePolicy.binding(new JSONObject().put("id", "5b594eac-0920-4fc2-80e2-8b208c8dc3ec").put("name", "営業開始の照明と入口").put("icon", "sun"));
            }
            JSONObject third = new JSONObject().put("key", "333333333333333333333333").put("name", "ロールスクリーン").put("kind", "shade");
            JSONObject fourth = new JSONObject().put("key", "444444444444444444444444").put("name", "入口ドア").put("kind", "lock");
            if (sceneShortcuts) {
                third = StoreWidgetScenePolicy.binding(new JSONObject().put("id", "2d306676-a5fb-491a-a6bb-e7206f042229").put("name", "昼休み").put("icon", "coffee"));
                fourth = StoreWidgetScenePolicy.binding(new JSONObject().put("id", "b8c4c765-a6ce-477c-959c-2d3ccf92c576").put("name", "閉店").put("icon", "lock"));
            }
            StoreWidgetDevicesData.saveSlots(context, 7, light, plug, third, fourth);
            for (JSONObject device : new JSONObject[]{light, plug, third, fourth}) {
                if (StoreWidgetScenePolicy.isScene(device)) continue;
                String key = device.optString("key"), session = InventoryApiClient.sessionKey();
                long now = android.os.SystemClock.elapsedRealtime();
                StoreWidgetDevicePolicy.recordRead(device, now, now);
                StoreWidgetDevicesData.save(context, session, "store", key, StoreWidgetDevicesData.beginRead(session, "store", key), device);
            }
        } else StoreWidgetDevicesData.saveSlots(context, 7, null, null);
        FrameLayout parent = new FrameLayout(context);
        int layout = InventoryWidgetPolicy.layout(width, height);
        RemoteViews remote = responsive ? InventoryWidgetProvider.responsiveViews(context, 7, data)
            : InventoryWidgetProvider.views(context, 7, layout, data);
        if (responsive) {
            // Exercise Android's launcher selection instead of selecting our preferred XML directly.
            remote = (RemoteViews) RemoteViews.class.getMethod("getRemoteViewsToApply", Context.class, SizeF.class)
                .invoke(remote, context, new SizeF(width, height));
        }
        View view = remote.apply(context, parent);
        float density = context.getResources().getDisplayMetrics().density;
        int w = Math.round(width * density), h = Math.round(height * density);
        parent.addView(view, new FrameLayout.LayoutParams(w, h));
        parent.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
        parent.layout(0, 0, w, h);
        if (layout == InventoryWidgetPolicy.DENSE || layout == InventoryWidgetPolicy.SUMMARY || layout == InventoryWidgetPolicy.EXPANDED) {
            int[] buttons = {R.id.inventory_widget_left, R.id.inventory_widget_right,
                R.id.inventory_widget_device_left, R.id.inventory_widget_device_right,
                R.id.inventory_widget_device_third, R.id.inventory_widget_device_fourth,
                R.id.inventory_widget_shortage, R.id.inventory_widget_restore};
            java.util.List<Rect> boxes = new java.util.ArrayList<>();
            for (int id : buttons) {
                View button = view.findViewById(id);
                assertNotNull(name + ": missing button " + id, button);
                assertEquals(name + ": hidden button " + id, View.VISIBLE, button.getVisibility());
                assertTrue(name + ": button has no action " + id, button.hasOnClickListeners());
                Rect box = new Rect(); button.getDrawingRect(box); parent.offsetDescendantRectToMyCoords(button, box);
                assertTrue(name + ": button outside widget", box.left >= 0 && box.right <= w && box.top >= 0 && box.bottom <= h);
                assertTrue(name + ": button has no usable area", box.width() >= 38 * density && box.height() >= 20 * density);
                for (Rect previous : boxes) assertFalse(name + ": overlapping buttons", Rect.intersects(previous, box));
                boxes.add(box);
            }
            Rect first = boxes.get(0), second = boxes.get(1), upper = boxes.get(2), lower = boxes.get(3), upperRight = boxes.get(4), lowerRight = boxes.get(5);
            assertTrue(name + ": devices must be in right column", upper.left >= second.right && second.left >= first.right);
            assertEquals(name + ": devices must be stacked", upper.left, lower.left);
            assertEquals(first.top, upper.top); assertEquals(first.bottom, lower.bottom);
            assertEquals(upperRight.left, lowerRight.left); assertEquals(upper.top, upperRight.top); assertEquals(lower.bottom, lowerRight.bottom);
            assertTrue(name + ": right grid columns need a visible gap", upperRight.left - upper.right >= 6 * density);
            assertTrue(name + ": right grid rows need a visible gap", lower.top - upper.bottom >= 6 * density);
            assertTrue(name + ": inventory row needs at least 8dp clearance", boxes.get(6).top - first.bottom >= 8 * density);
            assertTrue(name + ": operational controls must be narrower than before", Math.abs(4 * first.width() - 3 * (upperRight.right - upper.left)) <= 5);
            assertTrue(name + ": controls must have equal width", Math.abs(first.width() - second.width()) <= 1);
            for (int slot = 0; slot < StoreWidgetDevicesData.SLOT_COUNT; slot++) {
                ImageView icon = view.findViewById(StoreWidgetDevicesRenderer.ICONS[slot]);
                assertNotNull(name + ": missing device icon", icon);
                assertEquals(View.VISIBLE, icon.getVisibility()); assertNotNull(icon.getDrawable());
                Rect iconBox = new Rect(); icon.getDrawingRect(iconBox); parent.offsetDescendantRectToMyCoords(icon, iconBox);
                assertTrue(name + ": icon clipped by device button", boxes.get(slot + 2).contains(iconBox));
                View button = view.findViewById(StoreWidgetDevicesRenderer.BUTTONS[slot]);
                assertTrue(name + ": device name missing from accessibility label", button.getContentDescription().length() > 5);
            }
        }
        for (int id : new int[]{R.id.inventory_widget_title, R.id.inventory_widget_shortage, R.id.inventory_widget_restore,
            R.id.inventory_widget_left_title, R.id.inventory_widget_left_value,
            R.id.inventory_widget_right_title, R.id.inventory_widget_right_value,
            R.id.inventory_widget_device_left_title, R.id.inventory_widget_device_right_title,
            R.id.inventory_widget_device_third_title, R.id.inventory_widget_device_fourth_title}) {
            TextView target = view.findViewById(id);
            if (target == null) {
                assertTrue(name + ": missing label " + id, layout == InventoryWidgetPolicy.COMPACT || layout == InventoryWidgetPolicy.MINIMAL);
                continue;
            }
            boolean deviceLabel = id == R.id.inventory_widget_device_left_title || id == R.id.inventory_widget_device_right_title
                || id == R.id.inventory_widget_device_third_title || id == R.id.inventory_widget_device_fourth_title;
            if (deviceLabel && layout == InventoryWidgetPolicy.DENSE) {
                assertEquals(name + ": compact device button should show only its icon", View.GONE, target.getVisibility());
                continue;
            }
            assertEquals(name + ": hidden label " + id, View.VISIBLE, target.getVisibility());
            Rect box = new Rect();
            target.getDrawingRect(box);
            parent.offsetDescendantRectToMyCoords(target, box);
            assertTrue(name + ": control clipped " + id, box.left >= 0 && box.right <= w && box.top >= 0 && box.bottom <= h);
            assertTrue(name + ": text clipped " + id, target.getHeight() - target.getPaddingTop() - target.getPaddingBottom() >= target.getLineHeight());
            if (deviceLabel) {
                View card = (View)target.getParent();
                Rect cardBox = new Rect(); card.getDrawingRect(cardBox); parent.offsetDescendantRectToMyCoords(card, cardBox);
                assertTrue(name + ": device text outside card", box.top >= cardBox.top && box.bottom <= cardBox.bottom);
            }
            if (id == R.id.inventory_widget_shortage || id == R.id.inventory_widget_restore) {
                float inset = (width >= 250 ? 12 : width >= 160 ? 14 : 6) * density;
                assertTrue(name + ": action too close to shell", box.left >= inset && w - box.right >= inset && h - box.bottom >= inset);
            }
        }
        String output = System.getenv("FOUNDR1_WIDGET_PREVIEW_DIR");
        if (output != null) {
            java.io.File directory = new java.io.File(output);
            directory.mkdirs();
            Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            parent.draw(new Canvas(bitmap));
            try (java.io.FileOutputStream file = new java.io.FileOutputStream(new java.io.File(directory, name + ".png"))) {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, file);
            }
        }
        return view;
    }

    @Test public void renderLauncherSizesAndLongNames() throws Exception {
        for (int[] size : new int[][]{{110,56},{176,88},{250,110},{300,130},{330,140},{360,147},{250,148},{360,156},{360,164},{360,208},{360,280}}) {
            View view = render("widget-" + size[0] + "x" + size[1], size[0], size[1], "ja", sample());
            if (size[0] >= 250) assertEquals("57", ((TextView)view.findViewById(R.id.inventory_widget_count)).getText().toString());
        }
        render("widget-zh", 360, 164, "zh", sample());
        render("widget-dense-zh", 300, 130, "zh", sample());
        accessDevices = true;
        render("widget-lock-shade-dense", 300, 130, "ja", sample());
        render("widget-lock-shade", 360, 164, "ja", sample());
    }

    @Test public void unavailableAndFailedStatesCannotLookHealthy() throws Exception {
        InventoryWidgetData data = sample();
        data.latestRun.getJSONArray("platforms").getJSONObject(1).put("succeeded", 1).put("failed", 1);
        View failed = render("widget-failed", 360, 164, "ja", data);
        assertTrue(((TextView)failed.findViewById(R.id.inventory_widget_platforms)).getText().toString().contains("失敗"));
        data = new InventoryWidgetData();
        data.inventoryError = "auth";
        View expired = render("widget-login", 360, 164, "ja", data);
        assertEquals("—", ((TextView)expired.findViewById(R.id.inventory_widget_count)).getText().toString());
        assertTrue(((TextView)expired.findViewById(R.id.inventory_widget_platforms)).getText().toString().contains("ログイン"));
        data = sample(); data.shortages.clear(); data.latestRun = null;
        render("widget-empty", 360, 164, "ja", data);
    }

    @Test public void increasedSystemTextSizeKeepsActionsVisible() throws Exception {
        fontScale = 1.3f;
        for (int[] size : new int[][]{{110,56},{176,88},{250,110},{300,130},{250,148},{360,156},{360,164}})
            render("widget-large-text-" + size[0] + "x" + size[1], size[0], size[1], "ja", sample());
    }

    @Test public void deviceButtonsOpenTheirOwnConfirmationOrConfiguration() throws Exception {
        for (int height : new int[]{110, 148, 208}) for (boolean configured : new boolean[]{true, false}) {
            View view = render("widget-" + (configured ? "configured" : "empty") + "-" + height, 250, height, "ja", sample());
            for (int slot = 0; slot < StoreWidgetDevicesData.SLOT_COUNT; slot++) {
                View button = view.findViewById(StoreWidgetDevicesRenderer.BUTTONS[slot]);
                assertTrue(button.performClick());
                Intent intent = shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity();
                assertNotNull(intent);
                assertEquals(configured ? StoreWidgetDeviceActivity.class.getName() : InventoryWidgetConfigActivity.class.getName(), intent.getComponent().getClassName());
                assertEquals(7, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1));
                if (configured) {
                    assertEquals("store", intent.getStringExtra(StoreWidgetDeviceActivity.EXTRA_STORE));
                    assertEquals(slot, intent.getIntExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, -1));
                    assertEquals(new String[]{"111111111111111111111111","222222222222222222222222","333333333333333333333333","444444444444444444444444"}[slot], intent.getStringExtra(StoreWidgetDeviceActivity.EXTRA_KEY));
                }
            }
        }
    }

    @Test @Config(sdk = 35) public void responsiveLauncherIncludesDevicesAcrossFoldableSizes() throws Exception {
        responsive = true;
        for (int[] size : new int[][]{{110,56},{176,88},{250,110},{300,130},{500,120},{250,148},{360,208}})
            render("widget-launcher-" + size[0] + "x" + size[1], size[0], size[1], "ja", sample());
    }
    @Test public void sceneSlotsKeepLayoutAndOpenDistinctReadOnlyConfirmations() throws Exception {
        sceneShortcuts = true;
        for (String language : new String[]{"ja", "zh"}) for (int[] size : new int[][]{{300,130},{360,164},{360,208}}) {
            View view = render("widget-scenes-" + language + "-" + size[0] + "x" + size[1], size[0], size[1], language, sample());
            for (int slot = 0; slot < StoreWidgetDevicesData.SLOT_COUNT; slot++) {
                View button = view.findViewById(StoreWidgetDevicesRenderer.BUTTONS[slot]);
                assertTrue(button.getContentDescription().toString().contains(language.equals("ja") ? "シーン" : "场景"));
                assertTrue(button.performClick()); Intent intent = shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity();
                assertEquals(StoreWidgetSceneActivity.class.getName(), intent.getComponent().getClassName());
                assertEquals("widget-scenes", intent.getData().getHost());
                assertEquals(slot, intent.getIntExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, -1));
            }
        }
        fontScale = 1.3f;
        render("widget-scenes-large-text", 360, 164, "ja", sample());
    }
    @Test public void customSlotsRenderTheirOwnActionAndActualSyncResult() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        InventoryWidgetProvider.saveShortcuts(context, 7, "orders", "sync");
        View custom = render("widget-custom", 360, 164, "zh", sample());
        assertEquals("订单列表", ((TextView) custom.findViewById(R.id.inventory_widget_left_title)).getText().toString());
        assertEquals("全部完成", ((TextView) custom.findViewById(R.id.inventory_widget_right_value)).getText().toString());
        InventoryWidgetData data = sample();
        data.latestRun.getJSONArray("platforms").getJSONObject(0).put("succeeded", 0);
        View uncertain = render("widget-custom-unconfirmed", 360, 164, "zh", data);
        assertEquals("待确认", ((TextView) uncertain.findViewById(R.id.inventory_widget_right_value)).getText().toString());
        InventoryWidgetProvider.saveShortcuts(context, 7, "away", "reception");
        View swapped = render("widget-swapped", 360, 164, "zh", sample());
        assertEquals("离店提醒", ((TextView) swapped.findViewById(R.id.inventory_widget_left_title)).getText().toString());
    }
}
