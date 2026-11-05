package jp.foundr1.store;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

/** Device-local display preference; does not grant or replace kiosk access control. */
final class StoreNavigationBar {
    static final String EXTRA_HIDE_NAVIGATION = "foundr1_hide_navigation";
    private static final String PREFERENCES = "foundr1_display";
    private static final String HIDE_NAVIGATION = "hide_navigation";
    private static final int LEGACY_FLAGS = View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;

    private StoreNavigationBar() {}

    static void acceptLaunchIntent(Context context, Intent intent) {
        if (!"jp.foundr1.store".equals(context.getPackageName()) || intent == null
            || !intent.hasExtra(EXTRA_HIDE_NAVIGATION)) return;
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
            .putBoolean(HIDE_NAVIGATION, intent.getBooleanExtra(EXTRA_HIDE_NAVIGATION, false))
            .apply();
        intent.removeExtra(EXTRA_HIDE_NAVIGATION);
    }

    static void apply(Activity activity) {
        if (!"jp.foundr1.store".equals(activity.getPackageName())) return;
        SharedPreferences preferences = activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        // Existing installations retain their system-bar behavior until explicitly configured.
        if (!preferences.contains(HIDE_NAVIGATION)) return;
        boolean hidden = preferences.getBoolean(HIDE_NAVIGATION, false);
        View decor = activity.getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = activity.getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(hidden
                    ? WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    : WindowInsetsController.BEHAVIOR_DEFAULT);
                if (hidden) controller.hide(WindowInsets.Type.navigationBars());
                else controller.show(WindowInsets.Type.navigationBars());
            }
        } else {
            int flags = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(hidden ? flags | LEGACY_FLAGS : flags & ~LEGACY_FLAGS);
        }
        decor.requestApplyInsets();
    }
}
