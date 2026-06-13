package jp.foundr1.store;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.Window;
import android.view.WindowInsets;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public class Foundr1PrinterBridge {
    private static final int LINE_CHARS_80MM = 48;
    private static final int LINE_CHARS_58MM = 32;
    private static final int PAPER_DOTS_80MM = 576;
    private static final int PAPER_DOTS_58MM = 384;
    private static final int LOGO_MAX_HEIGHT_80MM = 150;
    private static final int LOGO_MAX_HEIGHT_58MM = 120;
    private static final UUID BLUETOOTH_SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");

    private final MainActivity activity;

    public Foundr1PrinterBridge(MainActivity activity) {
        this.activity = activity;
        requestBluetoothPermissionIfNeeded();
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }

    @JavascriptInterface
    public String print(String payloadJson) {
        try {
            PrintResult result = sendPrintJob(payloadJson);
            activity.runOnUiThread(() -> Toast.makeText(activity, result.message, Toast.LENGTH_SHORT).show());
            return "{\"ok\":true}";
        } catch (Exception error) {
            String message = error.getMessage() == null ? "印刷に失敗しました。" : error.getMessage();
            activity.runOnUiThread(() -> Toast.makeText(activity, "印刷に失敗しました: " + message, Toast.LENGTH_LONG).show());
            return "{\"ok\":false,\"error\":\"" + jsonEscape(message) + "\"}";
        }
    }

    private void requestBluetoothPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        if (activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) return;
        activity.requestPermissions(new String[] {
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN
        }, 2001);
    }

    private PrintResult sendPrintJob(String payloadJson) throws Exception {
        JSONObject payload = new JSONObject(payloadJson);
        JSONObject printer = payload.optJSONObject("printer");
        if (printer == null) throw new IllegalArgumentException("Printer settings are missing.");
        String deviceType = printer.optString("deviceType", "escpos_network");
        if ("star_printer".equals(deviceType)) {
            return sendStarPrintJob(payload, printer);
        }
        if ("escpos_bluetooth".equals(deviceType)) {
            return sendEscPosBluetoothPrintJob(payload, printer);
        }
        if ("escpos_usb".equals(deviceType)) {
            return sendEscPosUsbPrintJob(payload, printer);
        }
        String host = printer.optString("host", "").trim();
        int port = printer.optInt("port", 9100);
        if (host.isEmpty()) throw new IllegalArgumentException("Printer IP is empty.");

        byte[] bytes = buildEscPos(payload);
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 5000);
            socket.setSoTimeout(5000);
            OutputStream output = socket.getOutputStream();
            output.write(bytes);
            output.flush();
        }
        return new PrintResult("印刷を送信しました");
    }

    private PrintResult sendEscPosBluetoothPrintJob(JSONObject payload, JSONObject printer) throws Exception {
        String identifier = printer.optString("identifier", "").trim();
        if (identifier.isEmpty()) throw new IllegalArgumentException("Bluetooth printer identifier is empty.");
        byte[] bytes = buildEscPos(payload);
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new IllegalArgumentException("Bluetooth is not available on this device.");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            throw new IllegalArgumentException("Bluetooth permission is not granted.");
        }
        BluetoothDevice device = findBondedBluetoothDevice(adapter, identifier);
        if (device == null) throw new IllegalArgumentException("Paired Bluetooth printer was not found: " + identifier);
        try (BluetoothSocket socket = device.createRfcommSocketToServiceRecord(BLUETOOTH_SPP_UUID)) {
            adapter.cancelDiscovery();
            socket.connect();
            OutputStream output = socket.getOutputStream();
            output.write(bytes);
            output.flush();
        }
        return new PrintResult("Bluetooth プリンターに印刷を送信しました");
    }

    private BluetoothDevice findBondedBluetoothDevice(BluetoothAdapter adapter, String identifier) {
        String normalized = identifier.trim().toLowerCase(Locale.ROOT);
        Set<BluetoothDevice> devices = adapter.getBondedDevices();
        for (BluetoothDevice device : devices) {
            String name = device.getName() == null ? "" : device.getName();
            String address = device.getAddress() == null ? "" : device.getAddress();
            if (name.equalsIgnoreCase(identifier) || address.equalsIgnoreCase(identifier)) return device;
            if (name.toLowerCase(Locale.ROOT).contains(normalized)) return device;
        }
        return null;
    }

    private PrintResult sendEscPosUsbPrintJob(JSONObject payload, JSONObject printer) throws Exception {
        String identifier = printer.optString("identifier", "").trim();
        byte[] bytes = buildEscPos(payload);
        UsbManager manager = (UsbManager) activity.getSystemService(Context.USB_SERVICE);
        if (manager == null) throw new IllegalArgumentException("USB manager is not available.");
        UsbDevice device = findUsbPrinter(manager, identifier);
        if (device == null) throw new IllegalArgumentException("USB printer was not found.");
        if (!manager.hasPermission(device)) {
            PendingIntent permissionIntent = PendingIntent.getBroadcast(
                activity,
                0,
                new Intent("jp.foundr1.store.USB_PERMISSION"),
                PendingIntent.FLAG_IMMUTABLE
            );
            manager.requestPermission(device, permissionIntent);
            throw new IllegalArgumentException("USB printer permission was requested. Please allow it, then retry.");
        }
        UsbInterface usbInterface = findUsbPrinterInterface(device);
        UsbEndpoint endpoint = findUsbOutEndpoint(usbInterface);
        if (usbInterface == null || endpoint == null) throw new IllegalArgumentException("USB printer output endpoint was not found.");
        UsbDeviceConnection connection = manager.openDevice(device);
        if (connection == null) throw new IllegalArgumentException("USB printer could not be opened.");
        try {
            if (!connection.claimInterface(usbInterface, true)) throw new IllegalArgumentException("USB printer interface could not be claimed.");
            int offset = 0;
            while (offset < bytes.length) {
                int length = Math.min(4096, bytes.length - offset);
                int written = connection.bulkTransfer(endpoint, bytes, offset, length, 5000);
                if (written <= 0) throw new IllegalArgumentException("USB printer write failed.");
                offset += written;
            }
        } finally {
            connection.releaseInterface(usbInterface);
            connection.close();
        }
        return new PrintResult("USB プリンターに印刷を送信しました");
    }

    private UsbDevice findUsbPrinter(UsbManager manager, String identifier) {
        HashMap<String, UsbDevice> devices = manager.getDeviceList();
        UsbDevice fallback = null;
        for (UsbDevice device : devices.values()) {
            if (!hasUsbOutEndpoint(device)) continue;
            if (identifier == null || identifier.trim().isEmpty()) {
                if (fallback == null) fallback = device;
                continue;
            }
            if (matchesUsbIdentifier(device, identifier)) return device;
        }
        return fallback;
    }

    private boolean matchesUsbIdentifier(UsbDevice device, String identifier) {
        String normalized = identifier.trim().toLowerCase(Locale.ROOT);
        String vendorProduct = device.getVendorId() + ":" + device.getProductId();
        String vendorProductHex = Integer.toHexString(device.getVendorId()) + ":" + Integer.toHexString(device.getProductId());
        if (vendorProduct.equalsIgnoreCase(normalized) || vendorProductHex.equalsIgnoreCase(normalized)) return true;
        if (device.getDeviceName() != null && device.getDeviceName().toLowerCase(Locale.ROOT).contains(normalized)) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            String product = device.getProductName() == null ? "" : device.getProductName();
            String manufacturer = device.getManufacturerName() == null ? "" : device.getManufacturerName();
            return product.toLowerCase(Locale.ROOT).contains(normalized) || manufacturer.toLowerCase(Locale.ROOT).contains(normalized);
        }
        return false;
    }

    private boolean hasUsbOutEndpoint(UsbDevice device) {
        UsbInterface usbInterface = findUsbPrinterInterface(device);
        return usbInterface != null && findUsbOutEndpoint(usbInterface) != null;
    }

    private UsbInterface findUsbPrinterInterface(UsbDevice device) {
        UsbInterface fallback = null;
        for (int index = 0; index < device.getInterfaceCount(); index += 1) {
            UsbInterface usbInterface = device.getInterface(index);
            if (findUsbOutEndpoint(usbInterface) == null) continue;
            if (usbInterface.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return usbInterface;
            if (fallback == null) fallback = usbInterface;
        }
        return fallback;
    }

    private UsbEndpoint findUsbOutEndpoint(UsbInterface usbInterface) {
        if (usbInterface == null) return null;
        for (int index = 0; index < usbInterface.getEndpointCount(); index += 1) {
            UsbEndpoint endpoint = usbInterface.getEndpoint(index);
            if (endpoint.getDirection() == UsbConstants.USB_DIR_OUT
                && endpoint.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                return endpoint;
            }
        }
        return null;
    }

    private PrintResult sendStarPrintJob(JSONObject payload, JSONObject printer) throws Exception {
        String paperWidth = printer.optString("paperWidth", "58mm");
        String connectionType = printer.optString("connectionType", "bluetooth");
        String identifier = printer.optString("identifier", "").trim();
        if (!"usb".equals(connectionType) && identifier.isEmpty()) {
            throw new IllegalArgumentException("Star printer identifier is empty.");
        }
        boolean cutPaper = printer.optBoolean("cutPaper", true);
        boolean openCashDrawer = printer.optBoolean("openCashDrawer", false);
        Bitmap bitmap = createReceiptBitmap(payload, paperWidth);
        try {
            Foundr1StarPrinter.print(activity, connectionType, identifier, bitmap, cutPaper, openCashDrawer);
        } finally {
            bitmap.recycle();
        }
        return new PrintResult("Star プリンターに印刷を送信しました");
    }

    private byte[] buildEscPos(JSONObject payload) throws Exception {
        JSONObject printer = payload.optJSONObject("printer");
        String encoding = printer != null ? printer.optString("characterEncoding", "shift_jis") : "shift_jis";
        String paperWidth = printer != null ? printer.optString("paperWidth", "80mm") : "80mm";
        boolean cutPaper = printer == null || printer.optBoolean("cutPaper", true);
        boolean openCashDrawer = printer != null && printer.optBoolean("openCashDrawer", false);
        Charset charset = "utf8".equals(encoding) ? StandardCharsets.UTF_8 : Charset.forName("MS932");
        int columns = "58mm".equals(paperWidth) ? LINE_CHARS_58MM : LINE_CHARS_80MM;

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(new byte[] { 0x1B, 0x40 });
        out.write(new byte[] { 0x1B, 0x61, 0x00 });
        out.write(new byte[] { 0x1B, 0x21, 0x00 });
        applyCharacterEncoding(out, encoding);

        String jobType = payload.optString("jobType", "receipt");
        if ("test".equals(jobType)) {
            writeRawAsciiTest(out, printer, columns);
        } else {
            writeRasterReceipt(out, payload, paperWidth);
        }

        feedLines(out, 6);
        if (openCashDrawer) {
            out.write(new byte[] { 0x1B, 0x70, 0x00, 0x19, (byte) 0xFA });
        }
        if (cutPaper) {
            out.write(new byte[] { 0x1D, 0x56, 0x00 });
        }
        return out.toByteArray();
    }

    private void writeRawAsciiTest(ByteArrayOutputStream out, JSONObject printer, int columns) throws Exception {
        writeAsciiLine(out, "FOUND R1 OS PRINT TEST");
        writeAsciiLine(out, repeat("=", Math.min(columns, 32)));
        writeAsciiLine(out, "Printer bridge: OK");
        writeAsciiLine(out, "Host: " + (printer == null ? "" : printer.optString("host", "")));
        writeAsciiLine(out, "Port: " + (printer == null ? "9100" : printer.optInt("port", 9100)));
        writeAsciiLine(out, "Paper: " + (printer == null ? "80mm" : printer.optString("paperWidth", "80mm")));
        writeAsciiLine(out, new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.JAPAN).format(new Date()));
        writeAsciiLine(out, repeat("=", Math.min(columns, 32)));
        writeAsciiLine(out, "If you can read this,");
        writeAsciiLine(out, "Wi-Fi printing works.");
        writeEncodingProbe(out, "A UTF-8 / ESC t 255", StandardCharsets.UTF_8, new byte[] { 0x1B, 0x74, (byte) 0xFF });
        writeEncodingProbe(out, "B MS932 / ESC R Japan + t1", Charset.forName("MS932"), new byte[] { 0x1B, 0x52, 0x08, 0x1B, 0x74, 0x01 });
        writeEncodingProbe(out, "C MS932 / Kanji Shift_JIS", Charset.forName("MS932"), new byte[] { 0x1B, 0x52, 0x08, 0x1C, 0x26, 0x1C, 0x43, 0x01 });
    }

    private void applyCharacterEncoding(ByteArrayOutputStream out, String encoding) throws Exception {
        if ("utf8".equals(encoding)) {
            out.write(new byte[] { 0x1B, 0x74, (byte) 0xFF });
            return;
        }

        // Keep the normal receipt path in character mode. The test print below
        // prints multiple Japanese probes so the store can choose the working
        // XP-80T code page from the POS settings.
        out.write(new byte[] { 0x1B, 0x52, 0x08 });
        out.write(new byte[] { 0x1B, 0x74, 0x01 });
    }

    private void writeEncodingProbe(ByteArrayOutputStream out, String title, Charset charset, byte[] commands) throws Exception {
        out.write(new byte[] { 0x1B, 0x40 });
        out.write(commands);
        writeLine(out, title, charset);
        writeLine(out, "日本語テスト / 小計 / 合計 / お預かり", charset);
        writeLine(out, "カタカナ: アイス ミルク テイクアウト", charset);
        writeLine(out, "漢字: 店内 会計 厨房 領収書", charset);
        writeLine(out, repeat("-", 32), charset);
    }

    private void writeRasterReceipt(ByteArrayOutputStream out, JSONObject payload, String paperWidth) throws Exception {
        Bitmap bitmap = createReceiptBitmap(payload, paperWidth);
        try {
            writeRasterBitmap(out, bitmap);
        } finally {
            bitmap.recycle();
        }
    }

    private Bitmap createReceiptBitmap(JSONObject payload, String paperWidth) {
        int paperDots = "58mm".equals(paperWidth) ? PAPER_DOTS_58MM : PAPER_DOTS_80MM;
        int padding = 18;
        int contentWidth = paperDots - padding * 2;
        Paint normal = textPaint(24, false);
        Paint small = textPaint(21, false);
        Paint bold = textPaint(28, true);
        List<RasterLine> lines = new ArrayList<>();
        JSONObject order = payload.optJSONObject("order");
        JSONObject template = payload.optJSONObject("receiptTemplate");
        boolean isReceipt = "receipt".equals(payload.optString("jobType", "receipt"));
        String displayName = templateText(template, "businessName");

        if (isReceipt && template != null && template.optBoolean("showLogo", false)) {
            Bitmap logo = loadLogoBitmap(template.optString("logoUrl", ""), contentWidth, "58mm".equals(paperWidth) ? LOGO_MAX_HEIGHT_58MM : LOGO_MAX_HEIGHT_80MM);
            if (logo != null) lines.add(RasterLine.image(logo));
        }
        addCenter(lines, displayName.isEmpty() ? payload.optString("storeName", "Foundr1 OS") : displayName, bold);
        if (isReceipt && template != null) {
            addMultiline(lines, templateText(template, "companyInfo"), small, contentWidth);
            addMultiline(lines, templateText(template, "address"), small, contentWidth);
            addTextIfPresent(lines, "登録番号: " + templateText(template, "taxRegistrationNumber"), templateText(template, "taxRegistrationNumber"), small, contentWidth);
            addTextIfPresent(lines, "TEL: " + templateText(template, "phone"), templateText(template, "phone"), small, contentWidth);
            addTextIfPresent(lines, templateText(template, "website"), templateText(template, "website"), small, contentWidth);
            addMultiline(lines, templateText(template, "headerMessage"), small, contentWidth);
        }
        addSeparator(lines, contentWidth, normal);
        if (order == null) {
            addText(lines, "No order payload", normal, contentWidth);
        } else {
            addText(lines, "No. " + order.optString("pickupCode", ""), bold, contentWidth);
            addText(lines, joinReceiptMeta(formatOrderTypeLabel(order.optString("orderType", "")), formatPaymentLabel(order)), normal, contentWidth);
            addSeparator(lines, contentWidth, normal);
            JSONArray items = order.optJSONArray("items");
            if (items != null) {
                for (int i = 0; i < items.length(); i += 1) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    addPair(lines, item.optString("name", "Item") + " x" + item.optInt("quantity", 1), yen(item.optInt("amount", 0)), normal, contentWidth);
                    JSONArray options = item.optJSONArray("options");
                    if (options != null) {
                        for (int optionIndex = 0; optionIndex < options.length(); optionIndex += 1) {
                            addText(lines, "  " + options.optString(optionIndex), small, contentWidth);
                        }
                    }
                }
            }
            addSeparator(lines, contentWidth, normal);
            addPair(lines, "小計", yen(order.optInt("subtotalAmount", 0)), normal, contentWidth);
            int discount = order.optInt("discountAmount", 0);
            if (discount > 0) addPair(lines, "割引", "-" + yen(discount), normal, contentWidth);
            int coupon = order.optInt("couponDiscountAmount", 0);
            if (coupon > 0) addPair(lines, "クーポン", "-" + yen(coupon), normal, contentWidth);
            if (template == null || template.optBoolean("showTaxSummary", true)) {
                addPair(lines, "消費税", yen(order.optInt("taxAmount", 0)), normal, contentWidth);
            }
            addPair(lines, "合計", yen(order.optInt("totalAmount", 0)), bold, contentWidth);
            if ("cash".equals(order.optString("paymentMethod", ""))) {
                addPair(lines, "お預かり", yen(order.optInt("cashTenderedAmount", 0)), normal, contentWidth);
                addPair(lines, "お釣り", yen(order.optInt("cashChangeAmount", 0)), normal, contentWidth);
            }
            String note = order.optString("note", "").trim();
            if (!note.isEmpty() && (template == null || template.optBoolean("showOrderNote", true))) {
                addSeparator(lines, contentWidth, normal);
                addText(lines, "備考: " + note, small, contentWidth);
            }
        }
        addSeparator(lines, contentWidth, normal);
        if (isReceipt && template != null) {
            Bitmap promotionImage = loadTemplateBitmap(template.optString("promotionImageUrl", ""), contentWidth);
            if (promotionImage != null) lines.add(RasterLine.image(promotionImage));
            addMultiline(lines, templateText(template, "promotionMessage"), small, contentWidth);
            addMultiline(lines, templateText(template, "footerMessage"), small, contentWidth);
        }
        if (template == null || template.optBoolean("showTimestamp", true)) {
            addText(lines, new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.JAPAN).format(new Date()), normal, contentWidth);
        }

        int height = padding * 2;
        for (RasterLine line : lines) height += line.height();
        Bitmap bitmap = Bitmap.createBitmap(paperDots, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);
        int y = padding;
        for (RasterLine line : lines) {
            line.draw(canvas, padding, paperDots - padding, y);
            y += line.height();
        }
        return bitmap;
    }

    private String templateText(JSONObject template, String key) {
        return template == null ? "" : template.optString(key, "").trim();
    }

    private void addTextIfPresent(List<RasterLine> lines, String text, String value, Paint paint, int contentWidth) {
        if (!value.trim().isEmpty()) addText(lines, text, paint, contentWidth);
    }

    private void addMultiline(List<RasterLine> lines, String text, Paint paint, int contentWidth) {
        String value = text == null ? "" : text.trim();
        if (value.isEmpty()) return;
        for (String part : value.split("\\n")) addText(lines, part.trim(), paint, contentWidth);
    }

    private Bitmap loadLogoBitmap(String logoUrl, int maxWidth, int maxHeight) {
        return loadTemplateBitmap(logoUrl, maxWidth, maxHeight);
    }

    private Bitmap loadTemplateBitmap(String logoUrl, int maxWidth) {
        return loadTemplateBitmap(logoUrl, maxWidth, 0);
    }

    private Bitmap loadTemplateBitmap(String logoUrl, int maxWidth, int maxHeight) {
        if (logoUrl == null || logoUrl.trim().isEmpty()) return null;
        try (InputStream stream = new URL(logoUrl.trim()).openStream()) {
            Bitmap source = BitmapFactory.decodeStream(stream);
            if (source == null) return null;
            float scale = Math.min(1f, maxWidth / (float) source.getWidth());
            if (maxHeight > 0) scale = Math.min(scale, maxHeight / (float) source.getHeight());
            int width = Math.max(1, Math.round(source.getWidth() * scale));
            int height = Math.max(1, Math.round(source.getHeight() * scale));
            Bitmap scaled = Bitmap.createScaledBitmap(source, width, height, true);
            source.recycle();
            return scaled;
        } catch (Exception ignored) {
            return null;
        }
    }

    private String joinReceiptMeta(String left, String right) {
        String first = left == null ? "" : left.trim();
        String second = right == null ? "" : right.trim();
        if (first.isEmpty()) return second;
        if (second.isEmpty()) return first;
        return first + " / " + second;
    }

    private String formatOrderTypeLabel(String value) {
        String normalized = value == null ? "" : value.trim();
        if ("eat_in".equals(normalized) || "dine_in".equals(normalized)) return "店内";
        if ("takeout".equals(normalized) || "take_out".equals(normalized)) return "持ち帰り";
        if ("delivery".equals(normalized)) return "配達";
        if ("web".equals(normalized)) return "Web予約";
        return normalized;
    }

    private String formatPaymentLabel(JSONObject order) {
        String label = order == null ? "" : order.optString("paymentLabel", "").trim();
        if (!label.isEmpty()) return label;
        String method = order == null ? "" : order.optString("paymentMethod", "").trim();
        if ("cash".equals(method)) return "現金";
        if ("external_card".equals(method)) return "外部決済";
        if ("kitchen".equals(method)) return "厨房";
        if ("test".equals(method)) return "テスト";
        return method;
    }

    private Paint textPaint(int textSize, boolean bold) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTextSize(textSize);
        paint.setTypeface(Typeface.create(Typeface.SANS_SERIF, bold ? Typeface.BOLD : Typeface.NORMAL));
        return paint;
    }

    private void addCenter(List<RasterLine> lines, String text, Paint paint) {
        lines.add(RasterLine.center(text, paint));
    }

    private void addSeparator(List<RasterLine> lines, int contentWidth, Paint paint) {
        StringBuilder separator = new StringBuilder();
        while (paint.measureText(separator.toString()) < contentWidth) separator.append("-");
        lines.add(RasterLine.left(separator.toString(), paint));
    }

    private void addPair(List<RasterLine> lines, String left, String right, Paint paint, int contentWidth) {
        float rightWidth = paint.measureText(right);
        int leftWidth = Math.max(80, Math.round(contentWidth - rightWidth - 14));
        List<String> wrapped = wrapText(left, paint, leftWidth);
        if (wrapped.size() <= 1) {
            lines.add(RasterLine.pair(wrapped.isEmpty() ? "" : wrapped.get(0), right, paint));
            return;
        }
        for (String line : wrapped) lines.add(RasterLine.left(line, paint));
        lines.add(RasterLine.right(right, paint));
    }

    private void addText(List<RasterLine> lines, String text, Paint paint, int contentWidth) {
        for (String line : wrapText(text, paint, contentWidth)) lines.add(RasterLine.left(line, paint));
    }

    private List<String> wrapText(String text, Paint paint, int maxWidth) {
        List<String> lines = new ArrayList<>();
        String value = text == null ? "" : text;
        StringBuilder current = new StringBuilder();
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            String next = new String(Character.toChars(codePoint));
            if (current.length() > 0 && paint.measureText(current + next) > maxWidth) {
                lines.add(current.toString());
                current.setLength(0);
            }
            current.append(next);
            offset += Character.charCount(codePoint);
        }
        lines.add(current.toString());
        return lines;
    }

    private void writeRasterBitmap(ByteArrayOutputStream out, Bitmap bitmap) throws Exception {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int widthBytes = (width + 7) / 8;
        out.write(new byte[] {
            0x1D, 0x76, 0x30, 0x00,
            (byte) (widthBytes & 0xFF),
            (byte) ((widthBytes >> 8) & 0xFF),
            (byte) (height & 0xFF),
            (byte) ((height >> 8) & 0xFF)
        });
        for (int y = 0; y < height; y += 1) {
            for (int xByte = 0; xByte < widthBytes; xByte += 1) {
                int value = 0;
                for (int bit = 0; bit < 8; bit += 1) {
                    int x = xByte * 8 + bit;
                    if (x >= width) continue;
                    int pixel = bitmap.getPixel(x, y);
                    int luminance = (Color.red(pixel) * 299 + Color.green(pixel) * 587 + Color.blue(pixel) * 114) / 1000;
                    if (Color.alpha(pixel) > 128 && luminance < 180) value |= 0x80 >> bit;
                }
                out.write(value);
            }
        }
    }

    private void writeReceipt(ByteArrayOutputStream out, JSONObject payload, Charset charset, int columns) throws Exception {
        JSONObject order = payload.optJSONObject("order");
        if (order == null) {
            writeLine(out, "No order payload", charset);
            return;
        }
        writeLine(out, "No. " + order.optString("pickupCode", ""), charset);
        writeLine(out, joinReceiptMeta(formatOrderTypeLabel(order.optString("orderType", "")), formatPaymentLabel(order)), charset);
        writeLine(out, repeat("-", columns), charset);

        JSONArray items = order.optJSONArray("items");
        if (items != null) {
            for (int i = 0; i < items.length(); i += 1) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String name = item.optString("name", "Item");
                int quantity = item.optInt("quantity", 1);
                int amount = item.optInt("amount", 0);
                writeLine(out, fitLeftRight(name + " x" + quantity, yen(amount), columns), charset);
                JSONArray options = item.optJSONArray("options");
                if (options != null) {
                    for (int optionIndex = 0; optionIndex < options.length(); optionIndex += 1) {
                        writeWrapped(out, "  " + options.optString(optionIndex), charset, columns);
                    }
                }
            }
        }

        writeLine(out, repeat("-", columns), charset);
        writeLine(out, fitLeftRight("小計", yen(order.optInt("subtotalAmount", 0)), columns), charset);
        int discount = order.optInt("discountAmount", 0);
        if (discount > 0) writeLine(out, fitLeftRight("割引", "-" + yen(discount), columns), charset);
        int coupon = order.optInt("couponDiscountAmount", 0);
        if (coupon > 0) writeLine(out, fitLeftRight("クーポン", "-" + yen(coupon), columns), charset);
        writeLine(out, fitLeftRight("消費税", yen(order.optInt("taxAmount", 0)), columns), charset);
        writeLine(out, fitLeftRight("合計", yen(order.optInt("totalAmount", 0)), columns), charset);
        if ("cash".equals(order.optString("paymentMethod", ""))) {
            writeLine(out, fitLeftRight("お預かり", yen(order.optInt("cashTenderedAmount", 0)), columns), charset);
            writeLine(out, fitLeftRight("お釣り", yen(order.optInt("cashChangeAmount", 0)), columns), charset);
        }
        String note = order.optString("note", "").trim();
        if (!note.isEmpty()) {
            writeLine(out, repeat("-", columns), charset);
            writeWrapped(out, "備考: " + note, charset, columns);
        }
    }

    private void writeLine(ByteArrayOutputStream out, String text, Charset charset) throws Exception {
        out.write(text.getBytes(charset));
        out.write(0x0D);
        out.write(0x0A);
    }

    private void writeAsciiLine(ByteArrayOutputStream out, String text) throws Exception {
        out.write(text.getBytes(StandardCharsets.US_ASCII));
        out.write(0x0D);
        out.write(0x0A);
    }

    private void feedLines(ByteArrayOutputStream out, int count) throws Exception {
        for (int i = 0; i < count; i += 1) {
            out.write(0x0D);
            out.write(0x0A);
        }
    }

    private void writeWrapped(ByteArrayOutputStream out, String text, Charset charset, int columns) throws Exception {
        String value = text == null ? "" : text;
        while (value.length() > columns) {
            writeLine(out, value.substring(0, columns), charset);
            value = value.substring(columns);
        }
        writeLine(out, value, charset);
    }

    private String fitLeftRight(String left, String right, int columns) {
        String cleanLeft = left == null ? "" : left;
        String cleanRight = right == null ? "" : right;
        int spaces = Math.max(1, columns - cleanLeft.length() - cleanRight.length());
        if (cleanLeft.length() + cleanRight.length() >= columns) {
            return cleanLeft + " " + cleanRight;
        }
        return cleanLeft + repeat(" ", spaces) + cleanRight;
    }

    private String center(String text, int columns) {
        String value = text == null ? "" : text;
        int padding = Math.max(0, (columns - value.length()) / 2);
        return repeat(" ", padding) + value;
    }

    private String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < count; i += 1) builder.append(value);
        return builder.toString();
    }

    private String yen(int value) {
        return "JPY " + String.format(Locale.JAPAN, "%,d", Math.max(0, value));
    }

    private String jsonEscape(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

    private static class RasterLine {
        final String left;
        final String right;
        final Paint paint;
        final int align;
        final Bitmap image;

        private RasterLine(String left, String right, Paint paint, int align) {
            this.left = left;
            this.right = right;
            this.paint = paint;
            this.align = align;
            this.image = null;
        }

        private RasterLine(Bitmap image) {
            this.left = "";
            this.right = "";
            this.paint = null;
            this.align = 4;
            this.image = image;
        }

        static RasterLine left(String text, Paint paint) {
            return new RasterLine(text, "", paint, 0);
        }

        static RasterLine center(String text, Paint paint) {
            return new RasterLine(text, "", paint, 1);
        }

        static RasterLine right(String text, Paint paint) {
            return new RasterLine(text, "", paint, 2);
        }

        static RasterLine pair(String left, String right, Paint paint) {
            return new RasterLine(left, right, paint, 3);
        }

        static RasterLine image(Bitmap image) {
            return new RasterLine(image);
        }

        int height() {
            if (image != null) return image.getHeight() + 10;
            Paint.FontMetrics metrics = paint.getFontMetrics();
            return Math.round(metrics.descent - metrics.ascent) + 8;
        }

        void draw(Canvas canvas, int leftEdge, int rightEdge, int top) {
            if (image != null) {
                float x = leftEdge + (rightEdge - leftEdge - image.getWidth()) / 2f;
                canvas.drawBitmap(image, x, top + 5, null);
                return;
            }
            Paint.FontMetrics metrics = paint.getFontMetrics();
            float baseline = top - metrics.ascent + 2;
            if (align == 1) {
                float x = leftEdge + (rightEdge - leftEdge - paint.measureText(left)) / 2;
                canvas.drawText(left, x, baseline, paint);
            } else if (align == 2) {
                canvas.drawText(left, rightEdge - paint.measureText(left), baseline, paint);
            } else if (align == 3) {
                canvas.drawText(left, leftEdge, baseline, paint);
                canvas.drawText(right, rightEdge - paint.measureText(right), baseline, paint);
            } else {
                canvas.drawText(left, leftEdge, baseline, paint);
            }
        }
    }

    private static class PrintResult {
        final String message;

        PrintResult(String message) {
            this.message = message;
        }
    }
}
