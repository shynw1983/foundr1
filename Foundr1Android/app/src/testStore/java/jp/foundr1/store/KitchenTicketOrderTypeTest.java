package jp.foundr1.store;

import android.graphics.Bitmap;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import android.graphics.Canvas;
import android.graphics.Paint;
import java.util.ArrayList;
import java.util.List;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.Implementation;
import org.robolectric.shadows.ShadowLegacyCanvas;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, shadows = KitchenTicketOrderTypeTest.RecordingCanvas.class)
@GraphicsMode(GraphicsMode.Mode.LEGACY)
public class KitchenTicketOrderTypeTest {
    @Implements(Canvas.class)
    public static class RecordingCanvas extends ShadowLegacyCanvas {
        static final List<String> text = new ArrayList<>();
        static final List<float[]> bounds = new ArrayList<>();
        @Implementation protected void drawText(String value, float x, float y, Paint paint) {
            text.add(value);
            bounds.add(new float[]{x, y, paint.measureText(value)});
            super.drawText(value, x, y, paint);
        }
    }
    private String render(String job, String title, String type, String language, boolean show, String paper) throws Exception {
        return render(job, title, type, language, show, paper, "below", true, "037");
    }
    private String render(String job, String title, String type, String language, boolean show, String paper, String position, boolean showNumber, String number) throws Exception {
        Constructor<Foundr1PrinterBridge> constructor = Foundr1PrinterBridge.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        JSONObject order = new JSONObject().put("pickupCode", number).put("orderType", type)
            .put("paymentMethod", job.equals("kitchen") ? "kitchen" : "cash")
            .put("paymentLabel", job.equals("kitchen") ? "厨房" : "現金").put("items", new JSONArray());
        JSONObject template = new JSONObject().put("title", title).put("language", language)
            .put("orderTypePosition", position).put("showPickupCode", showNumber).put("showOrderType", show).put("showItems", false).put("showTimestamp", false)
            .put("blockOrder", new JSONArray().put("title").put("pickup").put("orderType"));
        JSONObject payload = new JSONObject().put("jobType", job).put("order", order).put("kitchenTicketTemplate", template);
        Method method = Foundr1PrinterBridge.class.getDeclaredMethod("createReceiptBitmap", JSONObject.class, String.class);
        method.setAccessible(true);
        RecordingCanvas.text.clear(); RecordingCanvas.bounds.clear();
        Bitmap bitmap = (Bitmap) method.invoke(constructor.newInstance(), payload, paper);
        try { return String.join("\n", RecordingCanvas.text); } finally { bitmap.recycle(); }
    }
    @Test public void kitchenAndFinishingOnlyShowDiningTypeAtBothWidths() throws Exception {
        for (String paper : new String[]{"58mm", "80mm"}) for (String title : new String[]{"厨房伝票", "出品伝票"}) {
            String text = render("kitchen", title, "eat_in", "ja", true, paper);
            assertTrue(text, text.contains(title)); assertTrue(text, text.contains("037"));
            assertTrue(text, text.contains("店内")); assertFalse(text, text.contains(" / 厨房"));
            assertEquals(text, title.equals("厨房伝票") ? 1 : 0, text.split("厨房", -1).length - 1);
        }
    }
    @Test public void takeoutChineseAndCustomTypesKeepDiningLabels() throws Exception {
        for (String[] test : new String[][]{{"takeout", "ja", "持ち帰り"}, {"eat_in", "zh", "堂食"}, {"custom", "ja", "custom"}}) {
            String text = render("kitchen", "出品伝票", test[0], test[1], true, "80mm");
            assertTrue(text, text.contains(test[2])); assertFalse(text, text.contains("厨房"));
        }
    }
    @Test public void visibilitySwitchStillHidesDiningType() throws Exception {
        String text = render("kitchen", "出品伝票", "eat_in", "ja", false, "80mm");
        assertFalse(text, text.contains("店内")); assertFalse(text, text.contains("厨房"));
    }
    @Test public void customerReceiptStillShowsPaymentMethod() throws Exception {
        String text = render("receipt", "レシート", "eat_in", "ja", true, "80mm");
        assertTrue(text, text.contains("店内 / 現金"));
    }
    @Test public void diningTypeIsRightAlignedOnTheNumberBaselineWithoutRepeatingASeparateRow() throws Exception {
        for (String paper : new String[]{"58mm", "80mm"}) for (String type : new String[]{"eat_in", "takeout"}) for (String number : new String[]{"037", "D6DFD0BFE"}) {
            String text = render("kitchen", "厨房伝票", type, "ja", true, paper, "number_right", true, number);
            String label = type.equals("eat_in") ? "店内" : "持ち帰り";
            int left = RecordingCanvas.text.indexOf("No. " + number), right = RecordingCanvas.text.indexOf(label);
            assertTrue(text, left >= 0 && right >= 0);
            float[] a = RecordingCanvas.bounds.get(left), b = RecordingCanvas.bounds.get(right);
            assertEquals(a[1], b[1], 0.1f);
            assertEquals(paper.equals("58mm") ? 366f : 558f, b[0] + b[2], 0.1f);
            assertTrue(text, a[0] + a[2] + 13 <= b[0]);
            assertEquals(1, RecordingCanvas.text.stream().filter(label::equals).count());
        }
    }
    @Test public void inlineSettingKeepsIndependentVisibilityAndFallsBackWhenNumberHidden() throws Exception {
        String text = render("kitchen", "出品伝票", "takeout", "ja", false, "58mm", "number_right", true, "037");
        assertTrue(text.contains("037")); assertFalse(text.contains("持ち帰り"));
        text = render("kitchen", "出品伝票", "takeout", "ja", true, "58mm", "number_right", false, "037");
        assertFalse(text.contains("037")); assertTrue(text.contains("持ち帰り"));
    }

}
