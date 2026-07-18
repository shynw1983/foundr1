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
import android.util.Log;
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

import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;

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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public class Foundr1PrinterBridge {
    private static final String TAG = "Foundr1PrinterBridge";
    private static final int LINE_CHARS_80MM = 48;
    private static final int LINE_CHARS_58MM = 32;
    private static final int PAPER_DOTS_80MM = 576;
    private static final int PAPER_DOTS_58MM = 384;
    private static final int LOGO_MAX_WIDTH_PERCENT = 58;
    private static final int LOGO_MAX_HEIGHT_80MM = 92;
    private static final int LOGO_MAX_HEIGHT_58MM = 76;
    private static final int LOGO_BOTTOM_GAP = 18;
    private static final UUID BLUETOOTH_SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");

    private final MainActivity activity;
    private final ExecutorService displayExecutor = Executors.newSingleThreadExecutor();
    private final AtomicReference<String> pendingDisplayPayload = new AtomicReference<>();
    private final AtomicBoolean displayWorkerRunning = new AtomicBoolean(false);

    public Foundr1PrinterBridge(MainActivity activity) {
        this.activity = activity;
        requestBluetoothPermissionIfNeeded();
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }

    @JavascriptInterface
    public String listPairedPrinters() {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) throw new IllegalArgumentException("Bluetooth is not available on this device.");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                requestBluetoothPermissionIfNeeded();
                throw new IllegalArgumentException("Bluetooth permission is not granted.");
            }
            JSONArray devicesJson = new JSONArray();
            Set<BluetoothDevice> devices = adapter.getBondedDevices();
            for (BluetoothDevice device : devices) {
                String name = device.getName() == null ? "" : device.getName();
                String address = device.getAddress() == null ? "" : device.getAddress();
                boolean likelyStarPrinter = isLikelyStarPrinterName(name);
                JSONObject record = new JSONObject();
                record.put("name", name);
                record.put("address", address);
                record.put("identifier", address.isEmpty() ? name : address);
                record.put("deviceType", likelyStarPrinter ? "star_printer" : "escpos_bluetooth");
                record.put("connectionType", "bluetooth");
                record.put("paperWidth", likelyStarPrinter ? "58mm" : "80mm");
                record.put("isLikelyStarPrinter", likelyStarPrinter);
                devicesJson.put(record);
            }
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("devices", devicesJson);
            return result.toString();
        } catch (Exception error) {
            String message = error.getMessage() == null ? "プリンター検索に失敗しました。" : error.getMessage();
            return "{\"ok\":false,\"error\":\"" + jsonEscape(message) + "\"}";
        }
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

    @JavascriptInterface
    public String display(String payloadJson) {
        if (payloadJson == null || payloadJson.trim().isEmpty()) {
            return "{\"ok\":false,\"error\":\"Display payload is empty.\"}";
        }
        pendingDisplayPayload.set(payloadJson);
        scheduleDisplayWorker();
        return "{\"ok\":true}";
    }

    private void scheduleDisplayWorker() {
        if (!displayWorkerRunning.compareAndSet(false, true)) return;
        displayExecutor.execute(() -> {
            try {
                String nextPayload;
                while ((nextPayload = pendingDisplayPayload.getAndSet(null)) != null) {
                    try {
                        sendStarDisplayJob(nextPayload);
                    } catch (Exception error) {
                        Log.w(TAG, "SCD222U display update failed", error);
                    }
                }
            } finally {
                displayWorkerRunning.set(false);
                if (pendingDisplayPayload.get() != null) scheduleDisplayWorker();
            }
        });
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

    private BluetoothDevice findAutoStarBluetoothDevice(BluetoothAdapter adapter) throws Exception {
        BluetoothDevice fallback = null;
        int matches = 0;
        Set<BluetoothDevice> devices = adapter.getBondedDevices();
        for (BluetoothDevice device : devices) {
            String name = device.getName() == null ? "" : device.getName();
            if (!isLikelyStarPrinterName(name)) continue;
            fallback = device;
            matches += 1;
        }
        if (matches == 1) return fallback;
        if (matches > 1) throw new IllegalArgumentException("Multiple paired Star printers were found. Please select one in POS settings.");
        throw new IllegalArgumentException("Paired Star printer was not found. Please pair mPOP in Android Bluetooth settings.");
    }

    private boolean isLikelyStarPrinterName(String name) {
        String normalized = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return normalized.contains("mpop")
            || normalized.contains("star")
            || normalized.contains("tsp")
            || normalized.contains("mcp")
            || normalized.contains("sp700");
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
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) throw new IllegalArgumentException("Bluetooth is not available on this device.");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                requestBluetoothPermissionIfNeeded();
                throw new IllegalArgumentException("Bluetooth permission is not granted.");
            }
            BluetoothDevice device = findAutoStarBluetoothDevice(adapter);
            identifier = device.getAddress() == null || device.getAddress().isEmpty() ? device.getName() : device.getAddress();
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

    private void sendStarDisplayJob(String payloadJson) throws Exception {
        JSONObject payload = new JSONObject(payloadJson);
        JSONObject printer = payload.optJSONObject("printer");
        if (printer == null || !"star_printer".equals(printer.optString("deviceType", ""))) {
            throw new IllegalArgumentException("SCD222U requires a Star printer connection.");
        }
        String connectionType = printer.optString("connectionType", "bluetooth");
        String identifier = printer.optString("identifier", "").trim();
        if (!"usb".equals(connectionType) && identifier.isEmpty()) {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) throw new IllegalArgumentException("Bluetooth is not available on this device.");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                requestBluetoothPermissionIfNeeded();
                throw new IllegalArgumentException("Bluetooth permission is not granted.");
            }
            BluetoothDevice device = findAutoStarBluetoothDevice(adapter);
            identifier = device.getAddress() == null || device.getAddress().isEmpty() ? device.getName() : device.getAddress();
        }
        Foundr1StarPrinter.display(
            activity,
            connectionType,
            identifier,
            payload.optString("line1", ""),
            payload.optString("line2", "")
        );
    }

    private byte[] buildEscPos(JSONObject payload) throws Exception {
        JSONObject printer = payload.optJSONObject("printer");
        String paperWidth = printer != null ? printer.optString("paperWidth", "80mm") : "80mm";
        boolean cutPaper = printer == null || printer.optBoolean("cutPaper", true);
        boolean openCashDrawer = printer != null && printer.optBoolean("openCashDrawer", false);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(new byte[] { 0x1B, 0x40 });
        out.write(new byte[] { 0x1B, 0x61, 0x00 });
        out.write(new byte[] { 0x1B, 0x21, 0x00 });
        writeRasterReceipt(out, payload, paperWidth);

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
        JSONObject order = payload.optJSONObject("order");
        JSONObject template = payload.optJSONObject("receiptTemplate");
        boolean isKitchen = "kitchen".equals(payload.optString("jobType", ""));
        JSONObject kitchenTemplate = payload.optJSONObject("kitchenTicketTemplate");
        boolean largeKitchenText = isKitchen && kitchenBool(kitchenTemplate, "largeText", true);
        Paint normal = textPaint(largeKitchenText ? 28 : 24, false);
        Paint small = textPaint(largeKitchenText ? 24 : 21, false);
        Paint bold = textPaint(largeKitchenText ? 34 : 28, true);
        List<RasterLine> lines = new ArrayList<>();

        if (isKitchen) {
            if (kitchenBool(kitchenTemplate, "showTitle", true)) {
                addCenter(lines, kitchenText(kitchenTemplate, "title", "厨房伝票"), bold);
            }
            if (kitchenBool(kitchenTemplate, "showStoreName", true)) {
                addCenter(lines, payload.optString("storeName", "Foundr1 OS"), normal);
            }
            addSeparator(lines, contentWidth, normal);
            if (order == null) {
                addText(lines, "No order payload", normal, contentWidth);
            } else {
                if (kitchenBool(kitchenTemplate, "showPickupCode", true)) {
                    addText(lines, "No. " + order.optString("pickupCode", ""), bold, contentWidth);
                }
                if (kitchenBool(kitchenTemplate, "showOrderType", true)) {
                    addText(lines, joinReceiptMeta(formatOrderTypeLabel(order.optString("orderType", "")), formatPaymentLabel(order)), normal, contentWidth);
                }
                if (kitchenBool(kitchenTemplate, "showItems", true)) {
                    addSeparator(lines, contentWidth, normal);
                    JSONArray items = order.optJSONArray("items");
                    if (items != null) {
                        for (int i = 0; i < items.length(); i += 1) {
                            JSONObject item = items.optJSONObject(i);
                            if (item == null) continue;
                            String itemLabel = item.optString("name", "Item") + " x" + item.optInt("quantity", 1);
                            if (kitchenBool(kitchenTemplate, "showAmounts", false)) {
                                addPair(lines, itemLabel, yen(item.optInt("amount", 0)), normal, contentWidth);
                            } else {
                                addText(lines, itemLabel, normal, contentWidth);
                            }
                            if (kitchenBool(kitchenTemplate, "showOptions", true)) {
                                JSONArray options = item.optJSONArray("options");
                                if (options != null) {
                                    for (int optionIndex = 0; optionIndex < options.length(); optionIndex += 1) {
                                        addText(lines, "  " + options.optString(optionIndex), small, contentWidth);
                                    }
                                }
                            }
                        }
                    }
                }
                if (kitchenBool(kitchenTemplate, "showAmounts", false)) {
                    addSeparator(lines, contentWidth, normal);
                    addPair(lines, "合計", yen(order.optInt("totalAmount", 0)), bold, contentWidth);
                }
                String note = order.optString("note", "").trim();
                if (!note.isEmpty() && kitchenBool(kitchenTemplate, "showNote", true)) {
                    addSeparator(lines, contentWidth, normal);
                    addText(lines, "備考: " + note, small, contentWidth);
                }
            }
            addSeparator(lines, contentWidth, normal);
            if (kitchenBool(kitchenTemplate, "showTimestamp", true)) {
                addText(lines, new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.JAPAN).format(new Date()), normal, contentWidth);
            }
        } else {
            addReceiptTemplateBlocks(lines, payload, order, template, paperWidth, contentWidth, normal, small, bold);
        }

        boolean compact = !isKitchen && template != null && "compact".equals(template.optString("density", "standard"));
        int height = padding * 2;
        for (RasterLine line : lines) height += line.height(compact);
        Bitmap bitmap = Bitmap.createBitmap(paperDots, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);
        int y = padding;
        for (RasterLine line : lines) {
            line.draw(canvas, padding, paperDots - padding, y);
            y += line.height(compact);
        }
        return bitmap;
    }

    private void addReceiptTemplateBlocks(List<RasterLine> output, JSONObject payload, JSONObject order, JSONObject template, String paperWidth, int contentWidth, Paint normal, Paint small, Paint bold) {
        HashMap<String, List<RasterLine>> blocks = new HashMap<>();
        String[] keys = { "logo", "business", "contact", "message", "receipt", "promotion", "qr", "footer" };
        for (String key : keys) blocks.put(key, new ArrayList<>());

        if (template != null && template.optBoolean("showLogo", false)) {
            int percent = Math.max(20, Math.min(100, template.optInt("logoWidthPercent", LOGO_MAX_WIDTH_PERCENT)));
            int maxWidth = Math.max(1, Math.round(contentWidth * percent / 100f));
            Bitmap logo = loadLogoBitmap(templateText(template, "logoUrl"), maxWidth, 0);
            if (logo != null) {
                blocks.get("logo").add(RasterLine.image(logo, templateAlignment(template, "logoAlignment", 1)));
                int bottomSpacing = Math.max(0, Math.min(40, template.optInt("logoBottomSpacing", 8)));
                if (bottomSpacing > 0) blocks.get("logo").add(RasterLine.spacer(bottomSpacing));
            }
        }

        Paint businessPaint = receiptTextPaint(template, "businessNameTextSize", 28, true);
        String displayName = templateText(template, "businessName");
        addAlignedText(blocks.get("business"), displayName.isEmpty() ? payload.optString("storeName", "Foundr1 OS") : displayName, businessPaint, contentWidth, templateAlignment(template, "businessNameAlignment", 1));

        int contactAlign = templateAlignment(template, "contactInfoAlignment", 0);
        addAlignedMultiline(blocks.get("contact"), templateText(template, "companyInfo"), small, contentWidth, contactAlign);
        addAlignedMultiline(blocks.get("contact"), templateText(template, "address"), small, contentWidth, contactAlign);
        addAlignedTextIfPresent(blocks.get("contact"), "登録番号: " + templateText(template, "taxRegistrationNumber"), templateText(template, "taxRegistrationNumber"), small, contentWidth, contactAlign);
        addAlignedTextIfPresent(blocks.get("contact"), "TEL: " + templateText(template, "phone"), templateText(template, "phone"), small, contentWidth, contactAlign);
        addAlignedTextIfPresent(blocks.get("contact"), templateText(template, "website"), templateText(template, "website"), small, contentWidth, contactAlign);

        int messageAlign = templateAlignment(template, "messageAlignment", 0);
        Paint messagePaint = receiptTextPaint(template, "messageTextSize", 21, false);
        addAlignedMultiline(blocks.get("message"), templateText(template, "headerMessage"), messagePaint, contentWidth, messageAlign);
        addReceiptContent(blocks.get("receipt"), order, template, contentWidth, normal, small, bold);

        int promoPercent = template == null ? 100 : Math.max(20, Math.min(100, template.optInt("promotionImageWidthPercent", 100)));
        Bitmap promo = loadTemplateBitmap(templateText(template, "promotionImageUrl"), Math.max(1, Math.round(contentWidth * promoPercent / 100f)), 0, true);
        if (promo != null) blocks.get("promotion").add(RasterLine.image(promo, templateAlignment(template, "promotionImageAlignment", 1)));
        addAlignedMultiline(blocks.get("promotion"), templateText(template, "promotionMessage"), messagePaint, contentWidth, messageAlign);

        if (template != null && template.optBoolean("qrCodeEnabled", false) && !templateText(template, "qrCodeUrl").isEmpty()) {
            String qrSize = template.optString("qrCodeSize", "medium");
            int dots = "small".equals(qrSize) ? Math.round(contentWidth * .34f) : "large".equals(qrSize) ? Math.round(contentWidth * .58f) : Math.round(contentWidth * .46f);
            Bitmap qr = createQrBitmap(templateText(template, "qrCodeUrl"), dots);
            if (qr != null) blocks.get("qr").add(RasterLine.image(qr, templateAlignment(template, "qrCodeAlignment", 1)));
            addAlignedTextIfPresent(blocks.get("qr"), templateText(template, "qrCodeLabel"), templateText(template, "qrCodeLabel"), messagePaint, contentWidth, templateAlignment(template, "qrCodeAlignment", 1));
        }

        addAlignedMultiline(blocks.get("footer"), templateText(template, "footerMessage"), messagePaint, contentWidth, messageAlign);
        if (template == null || template.optBoolean("showTimestamp", true)) addText(blocks.get("footer"), new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.JAPAN).format(new Date()), normal, contentWidth);

        Set<String> added = new java.util.HashSet<>();
        JSONArray requested = template == null ? null : template.optJSONArray("blockOrder");
        if (requested != null) for (int index = 0; index < requested.length(); index += 1) {
            String key = requested.optString(index, "");
            if (blocks.containsKey(key) && added.add(key)) output.addAll(blocks.get(key));
        }
        for (String key : keys) if (added.add(key)) output.addAll(blocks.get(key));
    }

    private void addReceiptContent(List<RasterLine> lines, JSONObject order, JSONObject template, int contentWidth, Paint normal, Paint small, Paint bold) {
        addSeparator(lines, contentWidth, normal);
        if (order == null) {
            addText(lines, "No order payload", normal, contentWidth);
            return;
        }
        boolean invoice = order.optBoolean("receiptRequested", false);
        String title = order.optString("receiptTitle", "").trim();
        if (title.isEmpty()) title = templateText(template, invoice ? "invoiceTitle" : "receiptTitle");
        if (title.isEmpty()) title = invoice ? "領収書" : "レシート";
        addCenter(lines, title, receiptTextPaint(template, "titleTextSize", 28, true));
        if (invoice) {
            String recipient = order.optString("receiptRecipientName", "").trim();
            if (recipient.isEmpty()) recipient = templateText(template, "invoiceRecipientName");
            String purpose = order.optString("receiptPurposeText", "").trim();
            if (purpose.isEmpty()) purpose = templateText(template, "invoicePurposeText");
            addPair(lines, recipient.isEmpty() ? "上様" : recipient, "様", bold, contentWidth);
            addText(lines, "但し " + (purpose.isEmpty() ? "飲食代" : purpose) + "として", small, contentWidth);
            addSeparator(lines, contentWidth, normal);
        }
        addText(lines, "No. " + order.optString("pickupCode", ""), bold, contentWidth);
        addText(lines, joinReceiptMeta(formatOrderTypeLabel(order.optString("orderType", "")), formatPaymentLabel(order)), normal, contentWidth);
        addSeparator(lines, contentWidth, normal);
        JSONArray items = order.optJSONArray("items");
        if (items != null) for (int index = 0; index < items.length(); index += 1) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            addPair(lines, item.optString("name", "Item") + " x" + item.optInt("quantity", 1), yen(item.optInt("amount", 0)), normal, contentWidth);
            JSONArray options = item.optJSONArray("options");
            if (options != null) for (int optionIndex = 0; optionIndex < options.length(); optionIndex += 1) addText(lines, "  " + options.optString(optionIndex), small, contentWidth);
        }
        addSeparator(lines, contentWidth, normal);
        addPair(lines, "小計", yen(order.optInt("subtotalAmount", 0)), normal, contentWidth);
        int discount = order.optInt("discountAmount", 0);
        if (discount > 0) addPair(lines, "割引", "-" + yen(discount), normal, contentWidth);
        int coupon = order.optInt("couponDiscountAmount", 0);
        if (coupon > 0) addPair(lines, "クーポン", "-" + yen(coupon), normal, contentWidth);
        if (template == null || template.optBoolean("showTaxSummary", true)) addPair(lines, formatTaxLabel(order), yen(order.optInt("taxAmount", 0)), normal, contentWidth);
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
        addSeparator(lines, contentWidth, normal);
    }

    private Paint receiptTextPaint(JSONObject template, String key, int standardSize, boolean bold) {
        String size = template == null ? "standard" : template.optString(key, "standard");
        int dots = "small".equals(size) ? Math.round(standardSize * .82f) : "large".equals(size) ? Math.round(standardSize * 1.22f) : standardSize;
        return textPaint(dots, bold);
    }

    private String templateText(JSONObject template, String key) {
        return template == null ? "" : template.optString(key, "").trim();
    }

    private int templateAlignment(JSONObject template, String key, int fallback) {
        if (template == null) return fallback;
        return "center".equals(template.optString(key, "")) ? 1 : 0;
    }

    private boolean kitchenBool(JSONObject template, String key, boolean fallback) {
        return template == null || !template.has(key) ? fallback : template.optBoolean(key, fallback);
    }

    private String kitchenText(JSONObject template, String key, String fallback) {
        String value = template == null ? "" : template.optString(key, "").trim();
        return value.isEmpty() ? fallback : value;
    }

    private void addTextIfPresent(List<RasterLine> lines, String text, String value, Paint paint, int contentWidth) {
        if (!value.trim().isEmpty()) addText(lines, text, paint, contentWidth);
    }

    private void addAlignedTextIfPresent(List<RasterLine> lines, String text, String value, Paint paint, int contentWidth, int alignment) {
        if (!value.trim().isEmpty()) addAlignedText(lines, text, paint, contentWidth, alignment);
    }

    private void addMultiline(List<RasterLine> lines, String text, Paint paint, int contentWidth) {
        String value = text == null ? "" : text.trim();
        if (value.isEmpty()) return;
        for (String part : value.split("\\n")) addText(lines, part.trim(), paint, contentWidth);
    }

    private void addAlignedMultiline(List<RasterLine> lines, String text, Paint paint, int contentWidth, int alignment) {
        String value = text == null ? "" : text.trim();
        if (value.isEmpty()) return;
        for (String part : value.split("\\n")) addAlignedText(lines, part.trim(), paint, contentWidth, alignment);
    }

    private Bitmap loadLogoBitmap(String logoUrl, int maxWidth, int maxHeight) {
        return loadTemplateBitmap(logoUrl, maxWidth, maxHeight, true);
    }

    private Bitmap createQrBitmap(String value, int size) {
        try {
            BitMatrix matrix = new MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, size, size);
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            for (int y = 0; y < size; y += 1) {
                for (int x = 0; x < size; x += 1) bitmap.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
            }
            return bitmap;
        } catch (Exception ignored) {
            return null;
        }
    }

    private Bitmap loadTemplateBitmap(String logoUrl, int maxWidth) {
        return loadTemplateBitmap(logoUrl, maxWidth, 0);
    }

    private Bitmap loadTemplateBitmap(String logoUrl, int maxWidth, int maxHeight) {
        return loadTemplateBitmap(logoUrl, maxWidth, maxHeight, false);
    }

    private Bitmap loadTemplateBitmap(String logoUrl, int maxWidth, int maxHeight, boolean allowUpscale) {
        if (logoUrl == null || logoUrl.trim().isEmpty()) return null;
        try (InputStream stream = new URL(logoUrl.trim()).openStream()) {
            Bitmap source = BitmapFactory.decodeStream(stream);
            if (source == null) return null;
            float scale = allowUpscale ? maxWidth / (float) source.getWidth() : Math.min(1f, maxWidth / (float) source.getWidth());
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
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT).replace("-", "_").replace(" ", "_");
        if ("eat_in".equals(normalized) || "dine_in".equals(normalized) || "eatin".equals(normalized) || "dinein".equals(normalized)) return "店内";
        if ("takeout".equals(normalized) || "take_out".equals(normalized) || "to_go".equals(normalized)) return "持ち帰り";
        if ("delivery".equals(normalized)) return "配達";
        if ("web".equals(normalized)) return "Web予約";
        return value == null ? "" : value.trim();
    }

    private String formatTaxLabel(JSONObject order) {
        double rate = order == null ? 0 : order.optDouble("taxRate", 0);
        if (!Double.isFinite(rate) || rate <= 0) return "消費税";
        if (Math.abs(rate - Math.round(rate)) < 0.001) return "消費税 " + Math.round(rate) + "%";
        return "消費税 " + String.format(Locale.JAPAN, "%.1f", rate) + "%";
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

    private void addAlignedText(List<RasterLine> lines, String text, Paint paint, int contentWidth, int alignment) {
        for (String line : wrapText(text, paint, contentWidth)) {
            lines.add(alignment == 1 ? RasterLine.center(line, paint) : RasterLine.left(line, paint));
        }
    }

    private void addCenteredTextIfPresent(List<RasterLine> lines, String text, Paint paint, int contentWidth) {
        String value = text == null ? "" : text.trim();
        if (value.isEmpty()) return;
        for (String line : wrapText(value, paint, contentWidth)) lines.add(RasterLine.center(line, paint));
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
        JSONObject template = payload.optJSONObject("receiptTemplate");
        if (order == null) {
            writeLine(out, "No order payload", charset);
            return;
        }
        boolean receiptRequested = order.optBoolean("receiptRequested", false);
        String receiptTitle = order.optString("receiptTitle", "").trim();
        if (receiptTitle.isEmpty() && template != null) {
            receiptTitle = template.optString(receiptRequested ? "invoiceTitle" : "receiptTitle", "").trim();
        }
        if (receiptTitle.isEmpty()) receiptTitle = receiptRequested ? "領収書" : "レシート";
        writeCentered(out, receiptTitle, charset, columns);
        if (receiptRequested) {
            String recipient = order.optString("receiptRecipientName", "").trim();
            if (recipient.isEmpty() && template != null) recipient = template.optString("invoiceRecipientName", "").trim();
            if (recipient.isEmpty()) recipient = "上様";
            String purpose = order.optString("receiptPurposeText", "").trim();
            if (purpose.isEmpty() && template != null) purpose = template.optString("invoicePurposeText", "").trim();
            if (purpose.isEmpty()) purpose = "飲食代";
            writeLine(out, fitLeftRight(recipient, "様", columns), charset);
            writeWrapped(out, "但し " + purpose + "として", charset, columns);
            writeLine(out, repeat("-", columns), charset);
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
        writeLine(out, fitLeftRight(formatTaxLabel(order), yen(order.optInt("taxAmount", 0)), columns), charset);
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

    private void writeCentered(ByteArrayOutputStream out, String text, Charset charset, int columns) throws Exception {
        writeLine(out, center(text, columns), charset);
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
        return "¥" + String.format(Locale.JAPAN, "%,d", Math.max(0, value));
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
        final int spacerHeight;

        private RasterLine(String left, String right, Paint paint, int align) {
            this.left = left;
            this.right = right;
            this.paint = paint;
            this.align = align;
            this.image = null;
            this.spacerHeight = 0;
        }

        private RasterLine(Bitmap image, int align) {
            this.left = "";
            this.right = "";
            this.paint = null;
            this.align = align == 0 ? 6 : 4;
            this.image = image;
            this.spacerHeight = 0;
        }

        private RasterLine(int spacerHeight) {
            this.left = "";
            this.right = "";
            this.paint = null;
            this.align = 5;
            this.image = null;
            this.spacerHeight = spacerHeight;
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
            return new RasterLine(image, 1);
        }

        static RasterLine image(Bitmap image, int align) {
            return new RasterLine(image, align);
        }

        static RasterLine spacer(int height) {
            return new RasterLine(Math.max(0, height));
        }

        int height() {
            return height(false);
        }

        int height(boolean compact) {
            if (spacerHeight > 0) return spacerHeight;
            if (image != null) return image.getHeight() + (compact ? 6 : 10);
            Paint.FontMetrics metrics = paint.getFontMetrics();
            return Math.round(metrics.descent - metrics.ascent) + (compact ? 3 : 8);
        }

        void draw(Canvas canvas, int leftEdge, int rightEdge, int top) {
            if (spacerHeight > 0) return;
            if (image != null) {
                float x = align == 6 ? leftEdge : leftEdge + (rightEdge - leftEdge - image.getWidth()) / 2f;
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
