package jp.foundr1.store;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 1001;
    private static final int FILE_CHOOSER_REQUEST = 1002;
    private static final int LINE_CHARS_80MM = 48;
    private static final int LINE_CHARS_58MM = 32;

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);

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

        webView.addJavascriptInterface(new Foundr1PrinterBridge(), "Foundr1Printer");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                if (host == null || host.endsWith("foundr1.jp") || host.equals("localhost") || host.equals("127.0.0.1")) {
                    return false;
                }
                return false;
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
    }

    public class Foundr1PrinterBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public String print(String payloadJson) {
            try {
                PrintResult result = sendPrintJob(payloadJson);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, result.message, Toast.LENGTH_SHORT).show());
                return "{\"ok\":true}";
            } catch (Exception error) {
                String message = error.getMessage() == null ? "印刷に失敗しました。" : error.getMessage();
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "印刷に失敗しました: " + message, Toast.LENGTH_LONG).show());
                return "{\"ok\":false,\"error\":\"" + jsonEscape(message) + "\"}";
            }
        }
    }

    private PrintResult sendPrintJob(String payloadJson) throws Exception {
        JSONObject payload = new JSONObject(payloadJson);
        JSONObject printer = payload.optJSONObject("printer");
        if (printer == null) throw new IllegalArgumentException("Printer settings are missing.");
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

    private byte[] buildEscPos(JSONObject payload) throws Exception {
        JSONObject printer = payload.optJSONObject("printer");
        String encoding = printer != null ? printer.optString("characterEncoding", "shift_jis") : "shift_jis";
        String paperWidth = printer != null ? printer.optString("paperWidth", "80mm") : "80mm";
        boolean cutPaper = printer == null || printer.optBoolean("cutPaper", true);
        boolean openCashDrawer = printer != null && printer.optBoolean("openCashDrawer", false);
        Charset charset = "utf8".equals(encoding) ? StandardCharsets.UTF_8 : Charset.forName("Shift_JIS");
        int columns = "58mm".equals(paperWidth) ? LINE_CHARS_58MM : LINE_CHARS_80MM;

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(new byte[] { 0x1B, 0x40 });
        writeLine(out, center(payload.optString("storeName", "Foundr1 OS"), columns), charset);
        writeLine(out, repeat("-", columns), charset);

        String jobType = payload.optString("jobType", "receipt");
        if ("test".equals(jobType)) {
            writeLine(out, center("Foundr1 OS Test Print", columns), charset);
            writeLine(out, "Printer OK", charset);
            JSONObject order = payload.optJSONObject("order");
            if (order != null) {
                JSONArray items = order.optJSONArray("items");
                if (items != null && items.length() > 0) {
                    JSONObject item = items.optJSONObject(0);
                    JSONArray options = item != null ? item.optJSONArray("options") : null;
                    if (options != null) {
                        for (int i = 0; i < options.length(); i += 1) {
                            writeLine(out, options.optString(i), charset);
                        }
                    }
                }
            }
        } else {
            writeReceipt(out, payload, charset, columns);
        }

        writeLine(out, repeat("-", columns), charset);
        writeLine(out, new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.JAPAN).format(new Date()), charset);
        out.write(new byte[] { 0x0A, 0x0A, 0x0A });
        if (openCashDrawer) {
            out.write(new byte[] { 0x1B, 0x70, 0x00, 0x19, (byte) 0xFA });
        }
        if (cutPaper) {
            out.write(new byte[] { 0x1D, 0x56, 0x00 });
        }
        return out.toByteArray();
    }

    private void writeReceipt(ByteArrayOutputStream out, JSONObject payload, Charset charset, int columns) throws Exception {
        JSONObject order = payload.optJSONObject("order");
        if (order == null) {
            writeLine(out, "No order payload", charset);
            return;
        }
        writeLine(out, "No. " + order.optString("pickupCode", ""), charset);
        writeLine(out, order.optString("orderType", "") + " / " + order.optString("paymentLabel", ""), charset);
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
        out.write(0x0A);
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
        return "¥" + String.format(Locale.JAPAN, "%,d", Math.max(0, value));
    }

    private String jsonEscape(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

    private static class PrintResult {
        final String message;

        PrintResult(String message) {
            this.message = message;
        }
    }
}
