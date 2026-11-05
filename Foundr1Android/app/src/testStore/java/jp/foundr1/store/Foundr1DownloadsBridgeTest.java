package jp.foundr1.store;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;
import org.robolectric.shadows.ShadowToast;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class Foundr1DownloadsBridgeTest {
    MainActivity activity;
    MainActivity.Foundr1DownloadsBridge bridge;

    @Before public void setUp() {
        // Attach the Activity without starting peripherals, network, push, or a WebView.
        activity = Robolectric.buildActivity(MainActivity.class).get();
        bridge = activity.new Foundr1DownloadsBridge();
    }

    @Test public void imageCapabilityIsExposedThroughJavascriptAndBadContentNeverRequestsPermission() throws Exception {
        assertTrue(bridge.isAvailable());
        assertTrue(bridge.supportsImages());
        assertNotNull(bridge.getClass().getMethod("supportsImages").getAnnotation(JavascriptInterface.class));
        JSONObject result = new JSONObject(bridge.saveBase64("photo.png", "image/png", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PDF)));
        assertFalse(result.getBoolean("ok"));
        assertTrue(result.getString("error").contains("一致"));
        assertNull(pendingData());
    }

    @Test public void legacyPermissionRetryWritesPngAndKeepsItsBytesAndExtension() throws Exception {
        Shadows.shadowOf((Application) activity.getApplication()).denyPermissions(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        String name = "sns-permission-test.png";
        JSONObject pending = new JSONObject(bridge.saveBase64(name, "image/png", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PNG)));
        assertTrue(pending.getBoolean("pending"));
        assertNotNull(pendingData());
        JSONObject duplicate = new JSONObject(bridge.saveBase64("second.png", "image/png", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PNG)));
        assertFalse(duplicate.getBoolean("ok"));
        File expected = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), name);
        if (expected.exists()) assertTrue(expected.delete());
        activity.onRequestPermissionsResult(1007, new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, new int[] { PackageManager.PERMISSION_GRANTED });
        assertArrayEquals(DownloadFilePolicyTest.PNG, Files.readAllBytes(expected.toPath()));
        assertFalse(new File(expected.getPath() + ".pdf").exists());
        assertNull(pendingData());
        assertTrue(expected.delete());
    }

    @Test public void legacyPermissionDenialAndDeferredWriteFailureRemainVisible() throws Exception {
        Shadows.shadowOf((Application) activity.getApplication()).denyPermissions(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        bridge.saveBase64("denied.png", "image/png", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PNG));
        activity.onRequestPermissionsResult(1007, new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, new int[] { PackageManager.PERMISSION_DENIED });
        assertTrue(ShadowToast.getTextOfLatestToast().contains("許可されません"));
        assertNull(pendingData());
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File backup = new File(downloads.getParentFile(), "Downloads-before-bridge-failure-" + System.nanoTime());
        boolean hadDownloads = downloads.exists();
        if (hadDownloads) assertTrue(downloads.renameTo(backup));
        try {
            // The Robolectric external-storage root is isolated. Preserve its previous
            // contents while making the download location unwritable as a directory.
            assertTrue(downloads.getParentFile().exists() || downloads.getParentFile().mkdirs());
            assertTrue(downloads.createNewFile());
            bridge.saveBase64("failure.png", "image/png", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PNG));
            activity.onRequestPermissionsResult(1007, new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, new int[] { PackageManager.PERMISSION_GRANTED });
            assertFalse(ShadowToast.getTextOfLatestToast().contains("保存しました"));
            assertNull(pendingData());
        } finally {
            assertTrue(downloads.delete());
            if (hadDownloads) assertTrue(backup.renameTo(downloads));
        }
    }

    @Test public void legacySavePreservesPayrollPdfAndDoesNotOverwriteExistingNames() throws Exception {
        Shadows.shadowOf((Application) activity.getApplication()).grantPermissions(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        String name = "給与明細-bridge-test.pdf";
        File directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        assertTrue(directory.exists() || directory.mkdirs());
        File first = new File(directory, name), second = new File(directory, "給与明細-bridge-test (1).pdf");
        if (first.exists()) assertTrue(first.delete());
        if (second.exists()) assertTrue(second.delete());
        assertTrue(new JSONObject(bridge.saveBase64(name, "application/pdf", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PDF))).getBoolean("ok"));
        assertTrue(new JSONObject(bridge.saveBase64(name, "application/pdf", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PDF))).getBoolean("ok"));
        assertArrayEquals(DownloadFilePolicyTest.PDF, Files.readAllBytes(first.toPath()));
        assertArrayEquals(DownloadFilePolicyTest.PDF, Files.readAllBytes(second.toPath()));
        assertTrue(first.delete()); assertTrue(second.delete());
    }

    @Test @Config(sdk = 35) public void scopedStoragePublishesCorrectMimeNameAndBytesForAllThreeFormats() throws Exception {
        RecordingDownloads provider = provider();
        for (String mime : new String[] { "image/png", "image/jpeg", "application/pdf" }) {
            byte[] bytes = mime.equals("image/png") ? DownloadFilePolicyTest.PNG : mime.equals("image/jpeg") ? DownloadFilePolicyTest.JPEG : DownloadFilePolicyTest.PDF;
            JSONObject result = new JSONObject(bridge.saveBase64("image", mime, DownloadFilePolicyTest.encoded(bytes)));
            assertTrue(result.toString(), result.getBoolean("ok"));
            assertEquals(mime, provider.inserted.getAsString(MediaStore.MediaColumns.MIME_TYPE));
            assertEquals("Download/Foundr1", provider.inserted.getAsString(MediaStore.MediaColumns.RELATIVE_PATH));
            assertEquals(Integer.valueOf(1), provider.inserted.getAsInteger(MediaStore.MediaColumns.IS_PENDING));
            assertEquals(Integer.valueOf(0), provider.published.getAsInteger(MediaStore.MediaColumns.IS_PENDING));
            assertArrayEquals(bytes, Files.readAllBytes(provider.file.toPath()));
            assertTrue(provider.inserted.getAsString(MediaStore.MediaColumns.DISPLAY_NAME).endsWith(mime.equals("image/png") ? ".png" : mime.equals("image/jpeg") ? ".jpg" : ".pdf"));
        }
    }

    @Test @Config(sdk = 35) public void scopedStorageCreationWriteAndPublishFailuresReturnErrorsAndRemovePartialRows() throws Exception {
        RecordingDownloads provider = provider();
        provider.failInsert = true;
        JSONObject result = new JSONObject(bridge.saveBase64("photo.png", "image/png", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PNG)));
        assertFalse(result.getBoolean("ok"));
        assertTrue(result.getString("error").contains("作成"));
        provider.failInsert = false; provider.failWrite = true;
        result = new JSONObject(bridge.saveBase64("photo.png", "image/png", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PNG)));
        assertFalse(result.getBoolean("ok"));
        assertEquals("test storage is full", result.getString("error"));
        assertEquals(1, provider.deleted);
        assertNull(provider.published);
        provider.failWrite = false; provider.failPublish = true;
        result = new JSONObject(bridge.saveBase64("photo.png", "image/png", DownloadFilePolicyTest.encoded(DownloadFilePolicyTest.PNG)));
        assertFalse(result.getBoolean("ok"));
        assertTrue(result.getString("error").contains("完了"));
        assertEquals(2, provider.deleted);
        assertFalse(provider.file.exists());
    }

    private String pendingData() throws Exception {
        java.lang.reflect.Field field = MainActivity.class.getDeclaredField("pendingDownloadBase64");
        field.setAccessible(true);
        return (String) field.get(activity);
    }

    private RecordingDownloads provider() {
        RecordingDownloads provider = new RecordingDownloads();
        ProviderInfo info = new ProviderInfo(); info.authority = "media";
        provider.attachInfo(activity, info);
        ShadowContentResolver.registerProviderInternal("media", provider);
        // Robolectric's one-argument openOutputStream intentionally swallows a
        // provider FileNotFoundException and returns a placeholder stream. Inject
        // the failure at write(), where real out-of-space errors occur, so this
        // verifies the production catch/rollback path instead of that shadow quirk.
        Shadows.shadowOf(activity.getContentResolver()).registerOutputStreamSupplier(
            Uri.parse("content://media/external/downloads/1"), () -> provider.failWrite ? new OutputStream() {
                @Override public void write(int value) throws IOException { throw new IOException("test storage is full"); }
            } : null
        );
        return provider;
    }

    public static class RecordingDownloads extends ContentProvider {
        ContentValues inserted, published;
        File file;
        boolean failInsert, failWrite, failPublish;
        int deleted;
        @Override public boolean onCreate() { return true; }
        @Override public Uri insert(Uri uri, ContentValues values) {
            inserted = new ContentValues(values);
            return failInsert ? null : Uri.parse("content://media/external/downloads/1");
        }
        @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
            file = new File(getContext().getCacheDir(), "download-provider-output");
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_TRUNCATE);
        }
        @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
            published = new ContentValues(values); return failPublish ? 0 : 1;
        }
        @Override public int delete(Uri uri, String selection, String[] args) { deleted++; if (file != null) file.delete(); return 1; }
        @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { return null; }
        @Override public String getType(Uri uri) { return "image/png"; }
    }
}
