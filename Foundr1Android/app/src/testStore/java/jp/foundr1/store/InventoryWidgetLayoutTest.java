package jp.foundr1.store;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.Before;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

/** Host-side RemoteViews rendering: no phone, account, network, or inventory mutations. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "ja-xhdpi", application = android.app.Application.class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class InventoryWidgetLayoutTest {
    private float fontScale = 1f;
    @Before public void controls() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        android.webkit.CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=layout-test");
        String session = InventoryApiClient.sessionKey();
        StoreWidgetControlsData.save(context, "store", session, "reception", new JSONObject().put("acceptanceMode", "auto"));
        StoreWidgetControlsData.save(context, "store", session, "away", new JSONObject().put("ready", true).put("canManage", true)
            .put("deliveryReady", true).put("sessionId", "layout-session").put("preference", new JSONObject()
                .put("enabled", false).put("exitRadius", 500).put("enterRadius", 300).put("version", "version")));
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
        FrameLayout parent = new FrameLayout(context);
        View view = InventoryWidgetProvider.views(context, 7, InventoryWidgetPolicy.layout(width, height), data).apply(context, parent);
        float density = context.getResources().getDisplayMetrics().density;
        int w = Math.round(width * density), h = Math.round(height * density);
        parent.addView(view, new FrameLayout.LayoutParams(w, h));
        parent.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
        parent.layout(0, 0, w, h);
        for (int id : new int[]{R.id.inventory_widget_title, R.id.inventory_widget_shortage, R.id.inventory_widget_restore,
            R.id.inventory_widget_left_value, R.id.inventory_widget_right_value}) {
            TextView target = view.findViewById(id);
            if (target == null) continue;
            Rect box = new Rect();
            target.getDrawingRect(box);
            parent.offsetDescendantRectToMyCoords(target, box);
            assertTrue(name + ": control clipped " + id, box.left >= 0 && box.right <= w && box.top >= 0 && box.bottom <= h);
            assertTrue(name + ": text clipped " + id, target.getHeight() - target.getPaddingTop() - target.getPaddingBottom() >= target.getLineHeight());
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
        for (int[] size : new int[][]{{110,56},{176,88},{250,110},{250,148},{360,156},{360,164},{360,208},{360,280}}) {
            View view = render("widget-" + size[0] + "x" + size[1], size[0], size[1], "ja", sample());
            if (size[0] >= 250) assertEquals("57", ((TextView)view.findViewById(R.id.inventory_widget_count)).getText().toString());
        }
        render("widget-zh", 360, 164, "zh", sample());
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
        for (int[] size : new int[][]{{110,56},{176,88},{250,110},{250,148},{360,156},{360,164}})
            render("widget-large-text-" + size[0], size[0], size[1], "ja", sample());
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
