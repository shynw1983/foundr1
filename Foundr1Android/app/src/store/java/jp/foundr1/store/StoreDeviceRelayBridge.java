package jp.foundr1.store;
import android.app.Activity;
import android.content.Intent;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
public final class StoreDeviceRelayBridge {
    private final Activity activity;
    private final android.webkit.WebView webView;
    public StoreDeviceRelayBridge(Activity activity, android.webkit.WebView webView) { this.activity=activity; this.webView=webView; }
    private boolean trusted() {
        java.util.concurrent.FutureTask<Boolean> check=new java.util.concurrent.FutureTask<>(()->{
            android.net.Uri uri=android.net.Uri.parse(webView.getUrl()==null?"":webView.getUrl());
            return "https".equals(uri.getScheme()) && "www.foundr1.jp".equals(uri.getHost())
                && "/store/device-relay".equals(uri.getPath());
        });
        activity.runOnUiThread(check);
        try{return check.get(5,java.util.concurrent.TimeUnit.SECONDS);}catch(Exception error){return false;}
    }
    @JavascriptInterface public String start(String token) {
        if(!trusted() || token==null || !token.matches("[A-Za-z0-9_-]{43}"))return "{\"ok\":false}";
        try {
            if(!token.equals(StoreDeviceRelayService.prefs(activity).getString("token",""))) {
                StoreAndBleScale.get(activity).setRelayContext(token,false,"",-1);
                StoreDeviceRelayService.relayStoreId="";
                StoreDeviceRelayService.relayStationId="";
                StoreDeviceRelayService.relayVerifiedElapsed=0;
            }
            StoreDeviceRelayLifecycle.enableAndStart(activity,token);
            return "{\"ok\":true}";
        }catch(Exception e){return "{\"ok\":false,\"error\":\"中継を開始できません。App を開いて再操作してください。\"}";}
    }
    @JavascriptInterface public String resume() {
        if(!trusted())return "{\"ok\":false}";
        return start(StoreDeviceRelayService.prefs(activity).getString("token",""));
    }
    @JavascriptInterface public String stop() {
        if(!trusted())return "{\"ok\":false}";
        try {
            StoreDeviceRelayLifecycle.stop(activity);
            return "{\"ok\":true}";
        } catch(Exception error) {
            return "{\"ok\":false,\"error\":\"停止設定を保存できません。もう一度操作してください。\"}";
        }
    }
    @JavascriptInterface public String status() {
        if(!trusted())return "{}";
        try {return new JSONObject().put("running",StoreDeviceRelayService.running).put("message",StoreDeviceRelayService.message).put("scale",scaleSnapshot()).toString();}
        catch(Exception e){return "{}";}
    }
    private JSONObject scaleSnapshot() throws Exception {
        return StoreAndBleScale.get(activity).snapshot()
            .put("storeId",StoreDeviceRelayService.relayStoreId)
            .put("stationId",StoreDeviceRelayService.relayStationId)
            .put("targetAgeMs",StoreDeviceRelayService.relayVerifiedElapsed>0?SystemClock.elapsedRealtime()-StoreDeviceRelayService.relayVerifiedElapsed:-1);
    }
    @JavascriptInterface public String scaleStatus() { if(!trusted())return "{}";try{return scaleSnapshot().toString();}catch(Exception error){return "{}";} }
    @JavascriptInterface public String backgroundStatus() {
        if(!trusted())return "{}";
        try {
            android.os.PowerManager power=activity.getSystemService(android.os.PowerManager.class);
            android.app.ActivityManager manager=activity.getSystemService(android.app.ActivityManager.class);
            return new JSONObject()
                .put("automaticResumeEnabled",StoreDeviceRelayLifecycle.isRequested(activity))
                .put("hasSavedConnection",StoreDeviceRelayLifecycle.hasSavedConnection(activity))
                .put("batteryOptimizationExempt",power!=null&&power.isIgnoringBatteryOptimizations(activity.getPackageName()))
                .put("backgroundRestricted",android.os.Build.VERSION.SDK_INT>=28&&manager!=null&&manager.isBackgroundRestricted())
                .put("manufacturer",android.os.Build.MANUFACTURER).put("model",android.os.Build.MODEL)
                .put("sdkInt",android.os.Build.VERSION.SDK_INT).toString();
        } catch(Exception error) { return "{}"; }
    }
    @JavascriptInterface public String openBackgroundSettings() {
        if(!trusted())return "{\"ok\":false}";
        java.util.concurrent.FutureTask<String> open=new java.util.concurrent.FutureTask<>(()->{
            if(activity.isFinishing())return "{\"ok\":false}";
            android.os.PowerManager power=activity.getSystemService(android.os.PowerManager.class);
            boolean exempt=power!=null&&power.isIgnoringBatteryOptimizations(activity.getPackageName());
            Intent details=new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:"+activity.getPackageName()));
            try {
                activity.startActivity(exempt?details:new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    android.net.Uri.parse("package:"+activity.getPackageName())));
                return "{\"ok\":true}";
            } catch(android.content.ActivityNotFoundException|SecurityException error) {
                try { activity.startActivity(details);return "{\"ok\":true}"; }
                catch(android.content.ActivityNotFoundException|SecurityException fallback) {
                    android.util.Log.w("Foundr1Relay","background settings unavailable",fallback);
                    return "{\"ok\":false,\"error\":\"Android のアプリ設定から、Store の電池制限を確認してください。\"}";
                }
            }
        });
        activity.runOnUiThread(open);
        try { return open.get(5,java.util.concurrent.TimeUnit.SECONDS); }
        catch(Exception error) { open.cancel(false);return "{\"ok\":false}"; }
    }
    @JavascriptInterface public String scaleScan() { return trusted()?StoreAndBleScale.get(activity).scan(activity).toString():"{\"ok\":false}"; }
    @JavascriptInterface public String scaleCancelScan() { return trusted()?StoreAndBleScale.get(activity).cancelScan().toString():"{\"ok\":false}"; }
    @JavascriptInterface public String scaleSelect(String address) { return trusted()?StoreAndBleScale.get(activity).select(address).toString():"{\"ok\":false}"; }
    @JavascriptInterface public String scaleDisconnect() { return trusted()?StoreAndBleScale.get(activity).disconnect().toString():"{\"ok\":false}"; }
    @JavascriptInterface public String scaleForget() { return trusted()?StoreAndBleScale.get(activity).forget().toString():"{\"ok\":false}"; }
}
