package jp.foundr1.store.bridge;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

final class BridgeOtaManager {
    static final String ACTION_CHANGED = "jp.foundr1.bridge.OTA_CHANGED";
    static final String EXTRA_OPEN_UPDATE = "openBridgeUpdate";
    private static final String PREFS = "bridge_ota";
    private static final String KEY_STATUS = "status";
    private static final String KEY_VERSION_CODE = "version_code";
    private static final String KEY_VERSION_NAME = "version_name";
    private static final String KEY_SHA256 = "sha256";
    private static final String KEY_FILE_PATH = "file_path";
    private static final String KEY_ERROR = "error";
    private static final String KEY_LAST_CHECK_AT = "last_check_at";
    private static final String STATUS_CURRENT = "current";
    private static final String STATUS_CHECKING = "checking";
    private static final String STATUS_DOWNLOADING = "downloading";
    private static final String STATUS_READY = "ready";
    private static final String STATUS_ERROR = "error";
    private static final long CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L;
    private static final long MAX_APK_BYTES = 150L * 1024L * 1024L;
    private static final String UPDATE_CHANNEL_ID = "foundr1_bridge_updates";
    private static final int UPDATE_NOTIFICATION_ID = 5210;
    private static final AtomicBoolean busy = new AtomicBoolean(false);

    private BridgeOtaManager() {}

    static void checkForUpdate(Context context, boolean force) {
        Context appContext = context.getApplicationContext();
        long now = System.currentTimeMillis();
        long lastCheckAt = prefs(appContext).getLong(KEY_LAST_CHECK_AT, 0L);
        if (!force && now - lastCheckAt < CHECK_INTERVAL_MS) return;
        if (!busy.compareAndSet(false, true)) return;
        prefs(appContext).edit()
            .putLong(KEY_LAST_CHECK_AT, now)
            .putString(KEY_STATUS, STATUS_CHECKING)
            .putString(KEY_ERROR, "")
            .apply();
        changed(appContext);
        new Thread(() -> {
            try {
                Release release = fetchRelease(appContext);
                if (release.versionCode <= currentVersionCode(appContext)) {
                    setCurrent(appContext);
                    return;
                }
                File target = releaseFile(appContext, release.versionCode);
                if (!target.exists() || !release.sha256.equalsIgnoreCase(sha256(target))) {
                    setStatus(appContext, STATUS_DOWNLOADING, release, target, "");
                    downloadRelease(release, target);
                }
                String downloadedSha = sha256(target);
                if (!release.sha256.equalsIgnoreCase(downloadedSha)) {
                    if (target.exists()) target.delete();
                    throw new IllegalStateException("ダウンロードした APK の検証に失敗しました");
                }
                setStatus(appContext, STATUS_READY, release, target, "");
                notifyUpdateReady(appContext, release);
            } catch (Exception error) {
                setError(appContext, error.getMessage());
            } finally {
                busy.set(false);
            }
        }, "bridge-ota-check").start();
    }

    static Snapshot snapshot(Context context) {
        android.content.SharedPreferences value = prefs(context);
        String filePath = value.getString(KEY_FILE_PATH, "");
        boolean fileExists = !filePath.isEmpty() && new File(filePath).isFile();
        String status = value.getString(KEY_STATUS, STATUS_CURRENT);
        if (STATUS_READY.equals(status) && !fileExists) status = STATUS_ERROR;
        return new Snapshot(
            status,
            value.getInt(KEY_VERSION_CODE, 0),
            value.getString(KEY_VERSION_NAME, ""),
            value.getString(KEY_ERROR, ""),
            fileExists
        );
    }

    static void requestInstall(Activity activity) {
        Snapshot state = snapshot(activity);
        String filePath = prefs(activity).getString(KEY_FILE_PATH, "");
        File apk = new File(filePath);
        if (!STATUS_READY.equals(state.status) || !apk.isFile()) {
            Toast.makeText(activity, "更新ファイルを確認しています", Toast.LENGTH_SHORT).show();
            checkForUpdate(activity, true);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !activity.getPackageManager().canRequestPackageInstalls()) {
            Intent permissionIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.getPackageName())
            );
            activity.startActivity(permissionIntent);
            Toast.makeText(activity, "このアプリからの更新を許可してください", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            installPackage(activity, apk);
            Toast.makeText(activity, "Android の更新確認を開きます", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            setError(activity, "更新を開始できません: " + safeMessage(error));
            Toast.makeText(activity, "更新を開始できませんでした", Toast.LENGTH_LONG).show();
        }
    }

    static void recordInstallFailure(Context context, String message) {
        setError(context, message);
    }

    static void clearAfterInstall(Context context) {
        File directory = updateDirectory(context);
        File[] files = directory.listFiles();
        if (files != null) {
            for (File file : files) file.delete();
        }
        setCurrent(context);
    }

    private static Release fetchRelease(Context context) throws Exception {
        String manifestUrl = appOrigin(context) + "/downloads/bridge/version.json?t=" + System.currentTimeMillis();
        HttpURLConnection connection = open(manifestUrl);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("更新確認 HTTP " + status);
            String json = readText(connection.getInputStream());
            JSONObject payload = new JSONObject(json);
            if (!context.getPackageName().equals(payload.optString("packageName", ""))) {
                throw new IllegalStateException("更新パッケージが一致しません");
            }
            int versionCode = payload.optInt("versionCode", 0);
            String versionName = payload.optString("versionName", "").trim();
            String downloadPath = payload.optString("latestDownloadPath", payload.optString("downloadPath", "")).trim();
            String expectedSha = payload.optString("sha256", "").trim().toLowerCase(Locale.US);
            long sizeBytes = payload.optLong("sizeBytes", 0L);
            if (versionCode <= 0 || downloadPath.isEmpty() || !expectedSha.matches("[0-9a-f]{64}")) {
                throw new IllegalStateException("更新情報が不完全です");
            }
            if (sizeBytes <= 0L || sizeBytes > MAX_APK_BYTES) {
                throw new IllegalStateException("更新ファイルのサイズが不正です");
            }
            return new Release(
                versionCode,
                versionName,
                releaseUrl(context, downloadPath),
                expectedSha,
                sizeBytes
            );
        } finally {
            connection.disconnect();
        }
    }

    private static void downloadRelease(Release release, File target) throws Exception {
        File temporary = new File(target.getParentFile(), target.getName() + ".tmp");
        if (temporary.exists()) temporary.delete();
        HttpURLConnection connection = open(release.downloadUrl);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("APK ダウンロード HTTP " + status);
            long declaredSize = connection.getContentLengthLong();
            if (declaredSize > MAX_APK_BYTES) throw new IllegalStateException("APK が大きすぎます");
            long written = 0L;
            try (
                InputStream input = new BufferedInputStream(connection.getInputStream());
                OutputStream output = new FileOutputStream(temporary)
            ) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    written += count;
                    if (written > MAX_APK_BYTES) throw new IllegalStateException("APK が大きすぎます");
                    output.write(buffer, 0, count);
                }
                output.flush();
            }
            if (written != release.sizeBytes) throw new IllegalStateException("APK サイズが一致しません");
            if (target.exists()) target.delete();
            if (!temporary.renameTo(target)) throw new IllegalStateException("APK を保存できません");
        } finally {
            connection.disconnect();
            if (temporary.exists()) temporary.delete();
        }
    }

    private static void installPackage(Context context, File apk) throws Exception {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        );
        params.setAppPackageName(context.getPackageName());
        int sessionId = installer.createSession(params);
        PackageInstaller.Session session = installer.openSession(sessionId);
        try (
            InputStream input = new FileInputStream(apk);
            OutputStream output = session.openWrite("bridge-update.apk", 0, apk.length())
        ) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            session.fsync(output);
        }
        Intent resultIntent = new Intent(context, BridgeUpdateInstallReceiver.class)
            .setAction("jp.foundr1.bridge.OTA_INSTALL_RESULT");
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, sessionId, resultIntent, flags);
        session.commit(pendingIntent.getIntentSender());
        session.close();
    }

    private static void notifyUpdateReady(Context context, Release release) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                UPDATE_CHANNEL_ID,
                "Foundr1 Bridge 更新",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Bridge の新しいバージョンを通知します");
            manager.createNotificationChannel(channel);
        }
        Intent activityIntent = new Intent(context, BridgeActivity.class)
            .putExtra(EXTRA_OPEN_UPDATE, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(context, UPDATE_NOTIFICATION_ID, activityIntent, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, UPDATE_CHANNEL_ID)
            : new Notification.Builder(context);
        Notification notification = builder
            .setSmallIcon(jp.foundr1.store.R.drawable.ic_bridge_status_ok)
            .setContentTitle("Bridge " + release.versionName + " を更新できます")
            .setContentText("ダウンロードと検証が完了しました。タップしてインストールします。")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .build();
        manager.notify(UPDATE_NOTIFICATION_ID, notification);
    }

    private static void setCurrent(Context context) {
        File directory = updateDirectory(context);
        File[] files = directory.listFiles();
        if (files != null) {
            for (File file : files) file.delete();
        }
        prefs(context).edit()
            .putString(KEY_STATUS, STATUS_CURRENT)
            .putString(KEY_ERROR, "")
            .putInt(KEY_VERSION_CODE, currentVersionCode(context))
            .putString(KEY_VERSION_NAME, BridgeStatusReporter.versionName(context))
            .putString(KEY_FILE_PATH, "")
            .apply();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(UPDATE_NOTIFICATION_ID);
        changed(context);
    }

    private static void setError(Context context, String error) {
        prefs(context).edit()
            .putString(KEY_STATUS, STATUS_ERROR)
            .putString(KEY_ERROR, safe(error))
            .apply();
        changed(context);
    }

    private static void setStatus(Context context, String status, Release release, File file, String error) {
        prefs(context).edit()
            .putString(KEY_STATUS, status)
            .putInt(KEY_VERSION_CODE, release.versionCode)
            .putString(KEY_VERSION_NAME, release.versionName)
            .putString(KEY_SHA256, release.sha256)
            .putString(KEY_FILE_PATH, file.getAbsolutePath())
            .putString(KEY_ERROR, safe(error))
            .apply();
        changed(context);
    }

    private static void changed(Context context) {
        context.sendBroadcast(new Intent(ACTION_CHANGED).setPackage(context.getPackageName()));
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(12_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("Cache-Control", "no-store");
        connection.setRequestProperty("User-Agent", "Foundr1-Bridge-OTA");
        connection.setInstanceFollowRedirects(true);
        return connection;
    }

    private static String readText(InputStream input) throws Exception {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static String appOrigin(Context context) {
        try {
            URL endpoint = new URL(BridgeConfig.endpoint(context));
            int port = endpoint.getPort();
            return endpoint.getProtocol() + "://" + endpoint.getHost() + (port > 0 ? ":" + port : "");
        } catch (Exception ignored) {
            return "https://www.foundr1.jp";
        }
    }

    private static String releaseUrl(Context context, String pathOrUrl) {
        if (pathOrUrl.startsWith("https://")) return pathOrUrl;
        if (pathOrUrl.startsWith("http://")) throw new IllegalArgumentException("安全でない更新 URL です");
        return appOrigin(context) + (pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl);
    }

    private static File updateDirectory(Context context) {
        File directory = new File(context.getFilesDir(), "bridge-updates");
        if (!directory.exists()) directory.mkdirs();
        return directory;
    }

    private static File releaseFile(Context context, int versionCode) {
        return new File(updateDirectory(context), "foundr1-bridge-" + versionCode + ".apk");
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
        }
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest()) value.append(String.format(Locale.US, "%02x", item & 0xff));
        return value.toString();
    }

    private static int currentVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? (int) info.getLongVersionCode()
                : info.versionCode;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static android.content.SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String safeMessage(Exception error) {
        return error == null ? "不明なエラー" : safe(error.getMessage());
    }

    private static String safe(String value) {
        String text = value == null ? "" : value.trim();
        return text.length() > 500 ? text.substring(0, 500) : text;
    }

    static final class Snapshot {
        final String status;
        final int versionCode;
        final String versionName;
        final String error;
        final boolean fileExists;

        Snapshot(String status, int versionCode, String versionName, String error, boolean fileExists) {
            this.status = status;
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.error = error;
            this.fileExists = fileExists;
        }
    }

    private static final class Release {
        final int versionCode;
        final String versionName;
        final String downloadUrl;
        final String sha256;
        final long sizeBytes;

        Release(int versionCode, String versionName, String downloadUrl, String sha256, long sizeBytes) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.downloadUrl = downloadUrl;
            this.sha256 = sha256;
            this.sizeBytes = sizeBytes;
        }
    }
}
