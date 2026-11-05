package jp.foundr1.store;

import java.util.Base64;
import java.util.Locale;

/** File contract shared by the JavaScript bridge and its storage-permission retry. */
public final class DownloadFilePolicy {
    // Keep the existing bridge ceiling; check before allocating decoded bytes.
    public static final int MAX_BASE64_LENGTH = 20_000_000;
    public static final int MAX_FILE_BYTES = 15_000_000;

    private DownloadFilePolicy() { }

    public static final class Download {
        public final String fileName;
        public final String mimeType;
        public final byte[] bytes;

        private Download(String fileName, String mimeType, byte[] bytes) {
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.bytes = bytes;
        }
    }

    public static Download prepare(String requestedFileName, String requestedMimeType, String encoded) {
        if (encoded == null || encoded.isEmpty() || encoded.length() > MAX_BASE64_LENGTH) {
            throw new IllegalArgumentException("保存データが空か、上限（15MB）を超えています。");
        }
        String mimeType = requestedMimeType == null ? "" : requestedMimeType.trim().toLowerCase(Locale.ROOT);
        if (!mimeType.equals("application/pdf") && !mimeType.equals("image/png") && !mimeType.equals("image/jpeg")) {
            throw new IllegalArgumentException("保存できる形式はPDF・PNG・JPEGです。");
        }
        byte[] bytes;
        try {
            // FileReader emits standard Base64. Retain support for line-wrapped PDF data,
            // while rejecting arbitrary characters instead of silently skipping them.
            String compact = encoded.replaceAll("[\\t\\n\\r ]", "");
            bytes = Base64.getDecoder().decode(compact);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("保存データを読み取れません。画像またはPDFを作成し直してください。");
        }
        if (bytes.length == 0 || bytes.length > MAX_FILE_BYTES) {
            throw new IllegalArgumentException("保存データが空か、上限（15MB）を超えています。");
        }
        if (!matchesSignature(mimeType, bytes)) {
            throw new IllegalArgumentException("保存データとファイル形式が一致しません。");
        }
        return new Download(fileName(requestedFileName, mimeType), mimeType, bytes);
    }

    static boolean matchesSignature(String mimeType, byte[] bytes) {
        if (mimeType.equals("application/pdf")) {
            return startsWith(bytes, new int[] { 0x25, 0x50, 0x44, 0x46, 0x2d });
        }
        if (mimeType.equals("image/png")) {
            return startsWith(bytes, new int[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a });
        }
        return mimeType.equals("image/jpeg") && startsWith(bytes, new int[] { 0xff, 0xd8, 0xff });
    }

    private static boolean startsWith(byte[] bytes, int[] prefix) {
        if (bytes.length < prefix.length) return false;
        for (int index = 0; index < prefix.length; index++) {
            if ((bytes[index] & 0xff) != prefix[index]) return false;
        }
        return true;
    }

    static String fileName(String requested, String mimeType) {
        String extension = mimeType.equals("application/pdf") ? ".pdf" : mimeType.equals("image/png") ? ".png" : ".jpg";
        String safe = requested == null ? "" : requested.trim().replaceAll("[\\p{Cntrl}\\\\/:*?\"<>|]+", "_");
        // A display name cannot be a relative path, hidden dot file, or empty basename.
        safe = safe.replaceFirst("^\\.+", "");
        if (safe.isEmpty()) safe = mimeType.equals("application/pdf") ? "foundr1-document" : "foundr1-image";
        String lower = safe.toLowerCase(Locale.ROOT);
        if (lower.endsWith(extension) || (mimeType.equals("image/jpeg") && lower.endsWith(".jpeg"))) {
            int suffixLength = lower.endsWith(".jpeg") ? 5 : extension.length();
            return trimName(safe.substring(0, safe.length() - suffixLength), safe.substring(safe.length() - suffixLength));
        }
        // Replace mismatched supported extensions; never produce photo.png.pdf.
        safe = safe.replaceAll("(?i)(?:\\.(?:pdf|png|jpe?g))+$", "");
        if (safe.isEmpty()) safe = mimeType.equals("application/pdf") ? "foundr1-document" : "foundr1-image";
        return trimName(safe, extension);
    }

    private static String trimName(String name, String extension) {
        // Limit filesystem names by UTF-8 bytes as Japanese payroll names are multibyte.
        while (name.getBytes(java.nio.charset.StandardCharsets.UTF_8).length + extension.length() > 220) {
            name = name.substring(0, name.offsetByCodePoints(name.length(), -1));
        }
        return name + extension;
    }
}
