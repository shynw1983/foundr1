package jp.foundr1.store;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.view.View;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class StoreNavigationBarTest {
    @Test public void unconfiguredDeviceKeepsItsExistingSystemUiFlags() {
        try (ActivityController<Activity> controller = Robolectric.buildActivity(Activity.class).setup()) {
            Activity activity = controller.get();
            int existing = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            activity.getWindow().getDecorView().setSystemUiVisibility(existing);
            StoreNavigationBar.apply(activity);
            assertEquals(existing, activity.getWindow().getDecorView().getSystemUiVisibility());
        }
    }

    @Test public void optInPersistsAcrossActivityRecreationWithoutReplayingTheExtra() {
        Intent intent = new Intent().putExtra(StoreNavigationBar.EXTRA_HIDE_NAVIGATION, true);
        try (ActivityController<Activity> controller = Robolectric.buildActivity(Activity.class).setup()) {
            StoreNavigationBar.acceptLaunchIntent(controller.get(), intent);
            assertFalse(intent.hasExtra(StoreNavigationBar.EXTRA_HIDE_NAVIGATION));
        }
        try (ActivityController<Activity> controller = Robolectric.buildActivity(Activity.class).setup()) {
            StoreNavigationBar.apply(controller.get());
            int flags = controller.get().getWindow().getDecorView().getSystemUiVisibility();
            assertTrue((flags & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) != 0);
            assertTrue((flags & View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY) != 0);
            assertEquals(0, flags & View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Test public void optOutRestoresNavigationWithoutClearingStatusBarAppearance() {
        try (ActivityController<Activity> controller = Robolectric.buildActivity(Activity.class).setup()) {
            Activity activity = controller.get();
            View decor = activity.getWindow().getDecorView();
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            StoreNavigationBar.acceptLaunchIntent(activity,
                new Intent().putExtra(StoreNavigationBar.EXTRA_HIDE_NAVIGATION, true));
            StoreNavigationBar.apply(activity);
            StoreNavigationBar.acceptLaunchIntent(activity,
                new Intent().putExtra(StoreNavigationBar.EXTRA_HIDE_NAVIGATION, false));
            StoreNavigationBar.apply(activity);
            assertEquals(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR, decor.getSystemUiVisibility());
        }
    }

    @Test public void otherAppFlavorsCannotEnableTheStoreDisplayPreference() {
        try (ActivityController<Activity> controller = Robolectric.buildActivity(Activity.class).setup()) {
            Activity activity = controller.get();
            Context otherFlavor = new ContextWrapper(activity) {
                @Override public String getPackageName() { return "jp.foundr1.os"; }
            };
            StoreNavigationBar.acceptLaunchIntent(otherFlavor,
                new Intent().putExtra(StoreNavigationBar.EXTRA_HIDE_NAVIGATION, true));
            StoreNavigationBar.apply(activity);
            assertEquals(0, activity.getWindow().getDecorView().getSystemUiVisibility()
                & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
        }
    }
}
