package jp.foundr1.store;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.Test;

public class DownloadFilePolicyTest {
    static final byte[] PNG = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fCEAAAAASUVORK5CYII=");
    static final byte[] JPEG = new byte[] { (byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xe0, 0, 2, (byte) 0xff, (byte) 0xd9 };
    static final byte[] PDF = "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF".getBytes(StandardCharsets.US_ASCII);

    static String encoded(byte[] bytes) { return Base64.getEncoder().encodeToString(bytes); }

    @Test public void payrollPdfAndBothImageFormatsRetainBytesAndCorrectNames() {
        DownloadFilePolicy.Download pdf = DownloadFilePolicy.prepare("給与明細-2026-10.pdf", "application/pdf", encoded(PDF));
        assertEquals("給与明細-2026-10.pdf", pdf.fileName);
        assertArrayEquals(PDF, pdf.bytes);
        DownloadFilePolicy.Download png = DownloadFilePolicy.prepare("maamaa-sns.png", "image/png", encoded(PNG));
        assertEquals("maamaa-sns.png", png.fileName);
        assertEquals("image/png", png.mimeType);
        assertArrayEquals(PNG, png.bytes);
        assertEquals("maamaa-sns.jpeg", DownloadFilePolicy.prepare("maamaa-sns.jpeg", " image/JPEG ", encoded(JPEG)).fileName);
        assertEquals("photo.jpg", DownloadFilePolicy.prepare("photo.png", "image/jpeg", encoded(JPEG)).fileName);
        assertEquals("photo.png", DownloadFilePolicy.prepare("photo.jpg.pdf", "image/png", encoded(PNG)).fileName);
    }

    @Test public void namesCannotEscapeDirectoryAndUnicodeTrimmingKeepsTheExtension() {
        String safe = DownloadFilePolicy.prepare("../photo/shot:\n.png", "image/png", encoded(PNG)).fileName;
        assertFalse(safe.contains("/"));
        assertFalse(safe.contains(".."));
        assertFalse(safe.contains("\n"));
        assertTrue(safe.endsWith(".png"));
        StringBuilder longName = new StringBuilder();
        for (int i = 0; i < 200; i++) longName.append("給");
        String result = DownloadFilePolicy.prepare(longName + ".PDF", "application/pdf", encoded(PDF)).fileName;
        assertTrue(result.endsWith(".PDF"));
        assertTrue(result.getBytes(StandardCharsets.UTF_8).length <= 220);
        assertEquals("foundr1-image.png", DownloadFilePolicy.prepare(null, "image/png", encoded(PNG)).fileName);
    }

    @Test public void unsupportedMimeAndDisguisedOrTruncatedContentAreRejected() {
        for (String mime : new String[] { "text/html", "application/octet-stream", "image/svg+xml", "image/gif", "image/heic", "" }) {
            reject(() -> DownloadFilePolicy.prepare("photo.png", mime, encoded(PNG)));
        }
        reject(() -> DownloadFilePolicy.prepare("photo.png", "image/png", encoded(JPEG)));
        reject(() -> DownloadFilePolicy.prepare("photo.jpg", "image/jpeg", encoded(PDF)));
        reject(() -> DownloadFilePolicy.prepare("photo.pdf", "application/pdf", encoded(PNG)));
        reject(() -> DownloadFilePolicy.prepare("photo.png", "image/png", encoded(new byte[] { (byte) 0x89, 0x50 })));
        reject(() -> DownloadFilePolicy.prepare("photo.png", "image/png", "data:image/png;base64," + encoded(PNG)));
        reject(() -> DownloadFilePolicy.prepare("photo.png", "image/png", "!not base64!"));
        reject(() -> DownloadFilePolicy.prepare("photo.png", "image/png", ""));
    }

    @Test public void payloadCeilingIsCheckedBeforeDecodingAndLineWrappedPdfStillWorks() {
        char[] oversized = new char[DownloadFilePolicy.MAX_BASE64_LENGTH + 1];
        java.util.Arrays.fill(oversized, 'A');
        reject(() -> DownloadFilePolicy.prepare("large.png", "image/png", new String(oversized)));
        String pdf = encoded(PDF);
        assertArrayEquals(PDF, DownloadFilePolicy.prepare("payroll", "application/pdf", pdf.substring(0, 8) + "\r\n" + pdf.substring(8)).bytes);
        assertEquals("payroll.pdf", DownloadFilePolicy.prepare("payroll", "application/pdf", pdf).fileName);
    }

    private static void reject(Runnable action) {
        try { action.run(); fail("invalid download accepted"); }
        catch (IllegalArgumentException expected) { assertFalse(expected.getMessage().isEmpty()); }
    }
}
