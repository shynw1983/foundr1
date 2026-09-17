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

/** Exercise the actual launch/confirmation UI while recording the network boundaries. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = android.app.Application.class)
public class StoreWidgetControlConfirmationTest {
    private Context context;
    private String session;

    public static class RecordingActivity extends StoreWidgetControlActivity {
        int reads, writes;
        boolean requestedEnabled;
        String requestedVersion;
        @Override void load() { reads++; }
        @Override void toggle(boolean enabled, String version) {
            writes++;
            requestedEnabled = enabled;
            requestedVersion = version;
        }
    }

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        StoreWidgetControlsData.prefs(context).edit().clear().commit();
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=confirmation-test");
        session = InventoryApiClient.sessionKey();
        AppWidgetProviderInfo info = new AppWidgetProviderInfo();
        info.provider = new ComponentName(context, InventoryWidgetProvider.class);
        shadowOf(AppWidgetManager.getInstance(context)).addBoundWidget(7, info);
    }

    private Intent prepare(boolean enabled, String language) throws Exception {
        InventoryWidgetProvider.saveConfiguration(context, 7, language, "store", "清水店", "", "");
        StoreWidgetControlsData.save(context, "store", session, "away", new JSONObject()
            .put("ready", true).put("canManage", true).put("preference", new JSONObject()
                .put("enabled", enabled).put("version", "confirmed-rule-version")
                .put("exitRadius", 750).put("enterRadius", 300)));
        // Retain the exact intent extras that used to trigger a write during onCreate.
        return new Intent(context, RecordingActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 7)
            .putExtra(StoreWidgetControlActivity.EXTRA_STORE, "store")
            .putExtra(StoreWidgetControlActivity.EXTRA_CONTROL, "away")
            .putExtra(StoreWidgetControlActivity.EXTRA_ENABLED, !enabled)
            .putExtra(StoreWidgetControlActivity.EXTRA_VERSION, "confirmed-rule-version")
            .putExtra(StoreWidgetControlActivity.EXTRA_SESSION, session);
    }

    private Button findButton(View view, String label) {
        if (view instanceof Button && label.contentEquals(((Button) view).getText())) return (Button) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                Button found = findButton(group.getChildAt(i), label);
                if (found != null) return found;
            }
        }
        return null;
    }

    private Button button(RecordingActivity activity, String label) {
        Button button = findButton(activity.getWindow().getDecorView(), label);
        assertNotNull("Missing confirmation action: " + label, button);
        return button;
    }

    @Test public void launcherTapAndCancelLeaveBothOnAndOffRulesUnchanged() throws Exception {
        for (boolean enabled : new boolean[]{true, false}) {
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, prepare(enabled, "zh")).setup()) {
                RecordingActivity activity = controller.get();
                assertEquals(0, activity.writes);
                assertEquals(0, activity.reads);
                button(activity, enabled ? "确认关闭" : "确认开启");
                button(activity, "取消").performClick();
                assertTrue(activity.isFinishing());
                assertEquals(0, activity.writes);
                assertEquals(enabled, StoreWidgetControlsData.read(context, "store").preference().getBoolean("enabled"));
            }
        }
    }

    @Test public void onlyExplicitConfirmationSubmitsTheDisplayedChangeAndVersion() throws Exception {
        for (boolean enabled : new boolean[]{true, false}) {
            String language = enabled ? "zh" : "ja";
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, prepare(enabled, language)).setup()) {
                RecordingActivity activity = controller.get();
                assertEquals(0, activity.writes);
                button(activity, enabled ? "确认关闭" : "オンにする").performClick();
                assertEquals(1, activity.writes);
                assertEquals(!enabled, activity.requestedEnabled);
                assertEquals("confirmed-rule-version", activity.requestedVersion);
            }
        }
    }

    @Test public void restoredSheetAndBackNeverReplayLegacyTapIntent() throws Exception {
        Bundle restored = new Bundle();
        restored.putBoolean("opened", true);
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, prepare(true, "ja")).setup(restored)) {
            RecordingActivity activity = controller.get();
            assertEquals(0, activity.writes);
            button(activity, "オフにする");
            button(activity, "キャンセル");
            activity.onBackPressed();
            assertTrue(activity.isFinishing());
            assertEquals(0, activity.writes);
            assertTrue(StoreWidgetControlsData.read(context, "store").preference().getBoolean("enabled"));
        }
    }
}
