package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

final class BridgeServiceStarter {
    private BridgeServiceStarter() {}

    static void ensureStarted(Context context, String source) {
        try {
            Intent intent = new Intent(context, BridgeForegroundService.class);
            intent.putExtra("startSource", source);
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (RuntimeException error) {
            BridgeCrashReporter.reportCaught(context, "service_start:" + source, error);
        }
    }
}
