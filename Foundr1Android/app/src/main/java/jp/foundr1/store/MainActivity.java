package jp.foundr1.store;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 1001;
    private static final int FILE_CHOOSER_REQUEST = 1002;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1003;
    private static final int LOCATION_PERMISSION_REQUEST = 1004;
    private static final int STARTUP_PERMISSION_REQUEST = 1005;
    private static final String NOTIFICATION_CHANNEL_ID = "foundr1_store_orders";
    private static final long APP_UPDATE_CHECK_INTERVAL_MS = 60L * 60L * 1000L;

    private FrameLayout rootView;
    private WebView webView;
    private PermissionRequest pendingPermissionRequest;
    private String pendingGeolocationOrigin;
    private GeolocationPermissions.Callback pendingGeolocationCallback;
    private ValueCallback<Uri[]> filePathCallback;
    private long lastAppUpdateCheckAt = 0L;
    private int lastPromptedVersionCode = 0;
    private boolean appUpdateDialogShowing = false;

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        rootView = new FrameLayout(this);
        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        rootView.addView(webView);
        setContentView(rootView);
        applySystemBarInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        createNotificationChannel();
        requestStartupPermissionsIfNeeded();
        addStorePrinterBridgeIfAvailable();
        webView.addJavascriptInterface(new Foundr1NotificationBridge(), "Foundr1NativeNotifications");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                if (host == null || host.endsWith("foundr1.jp") || host.equals("localhost") || host.equals("127.0.0.1")) {
                    return false;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                persistWebSession();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                pendingPermissionRequest = request;
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                } else {
                    requestPermissions(new String[] { Manifest.permission.CAMERA }, CAMERA_PERMISSION_REQUEST);
                }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingGeolocationOrigin = origin;
                pendingGeolocationCallback = callback;
                requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                }, LOCATION_PERMISSION_REQUEST);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST);
                return true;
            }
        });

        webView.loadUrl(getString(R.string.default_app_url));
        handleLaunchIntent(getIntent());
        checkNativeAppUpdateIfNeeded(false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        checkNativeAppUpdateIfNeeded(true);
    }

    @Override
    protected void onPause() {
        persistWebSession();
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onStop() {
        persistWebSession();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        persistWebSession();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleLaunchIntent(intent);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    private void applySystemBarInsets() {
        Window window = getWindow();
        rootView.setBackgroundColor(0xFFF8FAFC);
        window.setStatusBarColor(0xFFF8FAFC);
        window.setNavigationBarColor(0xFF0F172A);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                );
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.getDecorView().setSystemUiVisibility(
                window.getDecorView().getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            );
        }
        rootView.setOnApplyWindowInsetsListener((view, insets) -> {
            int top = insets.getSystemWindowInsetTop();
            int bottom = insets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                DisplayCutout cutout = insets.getDisplayCutout();
                if (cutout != null) {
                    top = Math.max(top, cutout.getSafeInsetTop());
                    bottom = Math.max(bottom, cutout.getSafeInsetBottom());
                }
            }
            FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) webView.getLayoutParams();
            int nextTop = top + dp(8);
            if (params.topMargin != nextTop || params.bottomMargin != bottom) {
                params.topMargin = nextTop;
                params.bottomMargin = bottom;
                webView.setLayoutParams(params);
            }
            return insets;
        });
        rootView.requestApplyInsets();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "Foundr1 STORE",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Web予約や店舗オペレーションの通知");
        channel.enableVibration(true);
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
    }

    private void requestStartupPermissionsIfNeeded() {
        List<String> permissions = new ArrayList<>();
        if (!hasLocationPermission()) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
            permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!permissions.isEmpty()) {
            requestPermissions(permissions.toArray(new String[0]), STARTUP_PERMISSION_REQUEST);
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean canShowNotifications() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void persistWebSession() {
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
            // Session persistence should not interrupt store operation.
        }
    }

    private void handleLaunchIntent(Intent intent) {
        if (intent == null || webView == null) return;
        String href = intent.getStringExtra("foundr1_href");
        if (href == null || href.trim().isEmpty()) return;
        webView.post(() -> webView.loadUrl(resolveAppUrl(href)));
        intent.removeExtra("foundr1_href");
    }

    private String resolveAppUrl(String href) {
        String value = href == null ? "" : href.trim();
        if (value.startsWith("https://") || value.startsWith("http://")) return value;
        String base = getString(R.string.default_app_url);
        try {
            URL url = new URL(base);
            return new URL(url, value.startsWith("/") ? value : "/" + value).toString();
        } catch (Exception error) {
            return base;
        }
    }

    private void checkNativeAppUpdateIfNeeded(boolean throttled) {
        long now = System.currentTimeMillis();
        if (throttled && now - lastAppUpdateCheckAt < APP_UPDATE_CHECK_INTERVAL_MS) return;
        lastAppUpdateCheckAt = now;
        String appKey = getAppKey();
        if (appKey.isEmpty()) return;
        String manifestUrl = getAppOrigin() + "/downloads/" + appKey + "/version.json?t=" + now;

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(manifestUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setRequestProperty("Cache-Control", "no-store");
                if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) return;

                BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
                StringBuilder json = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    json.append(line);
                }
                reader.close();

                JSONObject payload = new JSONObject(json.toString());
                int latestVersionCode = payload.optInt("versionCode", 0);
                int currentVersionCode = getCurrentVersionCode();
                if (latestVersionCode <= currentVersionCode || latestVersionCode <= lastPromptedVersionCode) return;

                String versionName = payload.optString("versionName", "");
                String title = payload.optString("title", getString(R.string.app_name));
                String downloadPath = payload.optString("latestDownloadPath", payload.optString("downloadPath", ""));
                if (downloadPath.trim().isEmpty()) return;
                String downloadUrl = resolveReleaseUrl(downloadPath);
                runOnUiThread(() -> showAppUpdateDialog(title, versionName, latestVersionCode, downloadUrl));
            } catch (Exception ignored) {
                // Native app update checks should never block WebView operation.
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    private int getCurrentVersionCode() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
            }
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (Exception error) {
            return 0;
        }
    }

    private String getAppKey() {
        String packageName = getPackageName();
        if (packageName.endsWith(".store")) return "store";
        if (packageName.endsWith(".os")) return "os";
        if (packageName.endsWith(".member")) return "member";
        if (packageName.endsWith(".staff")) return "staff";
        return "";
    }

    private String getAppOrigin() {
        try {
            URL url = new URL(getString(R.string.default_app_url));
            return url.getProtocol() + "://" + url.getHost();
        } catch (Exception error) {
            return "https://www.foundr1.jp";
        }
    }

    private String resolveReleaseUrl(String pathOrUrl) {
        String value = pathOrUrl == null ? "" : pathOrUrl.trim();
        if (value.startsWith("https://") || value.startsWith("http://")) return value;
        return getAppOrigin() + (value.startsWith("/") ? value : "/" + value);
    }

    private void showAppUpdateDialog(String title, String versionName, int versionCode, String downloadUrl) {
        if (isFinishing() || appUpdateDialogShowing) return;
        appUpdateDialogShowing = true;
        lastPromptedVersionCode = versionCode;
        String versionLabel = versionName == null || versionName.trim().isEmpty()
            ? String.valueOf(versionCode)
            : versionName + " (" + versionCode + ")";
        new AlertDialog.Builder(this)
            .setTitle("新しいアプリ版があります")
            .setMessage(title + " " + versionLabel + " をダウンロードできます。")
            .setPositiveButton("ダウンロード", (dialog, which) -> {
                appUpdateDialogShowing = false;
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)));
            })
            .setNegativeButton("あとで", (dialog, which) -> {
                appUpdateDialogShowing = false;
                dialog.dismiss();
            })
            .setOnCancelListener((dialog) -> appUpdateDialogShowing = false)
            .show();
    }

    private void showNativeNotification(String title, String body, String href, int notificationId) {
        if (!canShowNotifications()) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "通知が許可されていません。", Toast.LENGTH_SHORT).show());
            return;
        }
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("foundr1_href", href == null || href.trim().isEmpty() ? "/store/orders" : href);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new android.app.Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            : new android.app.Notification.Builder(this);
        builder
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(title == null || title.trim().isEmpty() ? "Foundr1 STORE" : title)
            .setContentText(body == null || body.trim().isEmpty() ? "新しい通知があります。" : body)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(body == null ? "" : body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setPriority(android.app.Notification.PRIORITY_HIGH);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(notificationId, builder.build());
    }

    private void addStorePrinterBridgeIfAvailable() {
        try {
            Class<?> bridgeClass = Class.forName("jp.foundr1.store.Foundr1PrinterBridge");
            Object bridge = bridgeClass.getConstructor(MainActivity.class).newInstance(this);
            webView.addJavascriptInterface(bridge, "Foundr1Printer");
        } catch (ClassNotFoundException ignored) {
            // Printer support is included only in the Store APK.
        } catch (Exception error) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "プリンターブリッジを初期化できませんでした。", Toast.LENGTH_LONG).show());
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST && pendingPermissionRequest != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            } else {
                pendingPermissionRequest.deny();
            }
            pendingPermissionRequest = null;
        }
        if ((requestCode == LOCATION_PERMISSION_REQUEST || requestCode == STARTUP_PERMISSION_REQUEST) && pendingGeolocationCallback != null) {
            boolean granted = hasLocationPermission();
            pendingGeolocationCallback.invoke(pendingGeolocationOrigin, granted, false);
            pendingGeolocationOrigin = null;
            pendingGeolocationCallback = null;
        }
    }

    public class Foundr1NotificationBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public boolean canShow() {
            return canShowNotifications();
        }

        @JavascriptInterface
        public String show(String payloadJson) {
            try {
                JSONObject payload = new JSONObject(payloadJson);
                String title = payload.optString("title", "Foundr1 STORE");
                String body = payload.optString("body", payload.optString("message", "新しい通知があります。"));
                String href = payload.optString("href", "/store/orders");
                String tag = payload.optString("tag", title + ":" + body);
                int notificationId = Math.abs(tag.hashCode());
                runOnUiThread(() -> showNativeNotification(title, body, href, notificationId));
                return "{\"ok\":true}";
            } catch (Exception error) {
                String message = error.getMessage() == null ? "通知を表示できませんでした。" : error.getMessage();
                return "{\"ok\":false,\"error\":\"" + jsonEscape(message) + "\"}";
            }
        }
    }


    private String jsonEscape(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

}
