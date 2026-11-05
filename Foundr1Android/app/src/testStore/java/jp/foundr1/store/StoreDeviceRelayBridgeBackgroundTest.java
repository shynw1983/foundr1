package jp.foundr1.store;

import android.app.Activity;
import android.app.Application;
import android.content.Intent;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,application=Application.class)
@LooperMode(LooperMode.Mode.PAUSED)
public class StoreDeviceRelayBridgeBackgroundTest {
    public static class RecordingActivity extends Activity {
        final List<Intent> settings=new ArrayList<>();
        int failures;
        @Override public void startActivity(Intent intent) {
            settings.add(intent);
            if(failures>0){failures--;throw new SecurityException("simulated unavailable settings");}
        }
    }
    private RecordingActivity activity;
    private WebView web;
    private StoreDeviceRelayBridge bridge;
    @Before public void setup() {
        activity=Robolectric.buildActivity(RecordingActivity.class).setup().get();
        StoreDeviceRelayService.prefs(activity).edit().clear().commit();
        web=new WebView(activity);web.loadUrl("https://www.foundr1.jp/store/device-relay");
        bridge=new StoreDeviceRelayBridge(activity,web);
    }
    @After public void teardown(){web.destroy();activity.finish();}

    @Test public void pollingBackgroundStatusNeverOpensSystemSettings() throws Exception {
        JSONObject status=new JSONObject(bridge.backgroundStatus());
        assertFalse(status.getBoolean("automaticResumeEnabled"));
        assertFalse(status.getBoolean("hasSavedConnection"));
        assertTrue(status.has("batteryOptimizationExempt"));
        assertTrue(status.has("backgroundRestricted"));
        assertTrue(activity.settings.isEmpty());
    }
    @Test public void explicitSettingsActionRequestsExemptionOnlyForThisPackage() throws Exception {
        assertTrue(new JSONObject(bridge.openBackgroundSettings()).getBoolean("ok"));
        assertEquals(1,activity.settings.size());
        assertEquals(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,activity.settings.get(0).getAction());
        assertEquals("package:"+activity.getPackageName(),activity.settings.get(0).getDataString());
    }
    @Test public void anAlreadyExemptPhoneOpensItsAppDetails() throws Exception {
        PowerManager power=activity.getSystemService(PowerManager.class);
        shadowOf(power).setIgnoringBatteryOptimizations(activity.getPackageName(),true);
        assertTrue(new JSONObject(bridge.backgroundStatus()).getBoolean("batteryOptimizationExempt"));
        assertTrue(new JSONObject(bridge.openBackgroundSettings()).getBoolean("ok"));
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,activity.settings.get(0).getAction());
    }
    @Test public void anUnavailableRequestFallsBackAndReportsCompleteFailure() throws Exception {
        activity.failures=1;
        assertTrue(new JSONObject(bridge.openBackgroundSettings()).getBoolean("ok"));
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,activity.settings.get(1).getAction());
        activity.settings.clear();activity.failures=2;
        JSONObject failed=new JSONObject(bridge.openBackgroundSettings());
        assertFalse(failed.getBoolean("ok"));assertTrue(failed.has("error"));
    }
    @Test public void otherPagesCannotReadOrOpenNativeBackgroundSettings() throws Exception {
        for(String url:new String[]{"https://www.foundr1.jp/store/pos","https://foundr1.jp/store/device-relay","https://www.foundr1.jp.attacker.example/store/device-relay"}){
            web.loadUrl(url);
            assertEquals("{}",bridge.backgroundStatus());
            assertFalse(new JSONObject(bridge.openBackgroundSettings()).getBoolean("ok"));
        }
        assertTrue(activity.settings.isEmpty());
    }
}
