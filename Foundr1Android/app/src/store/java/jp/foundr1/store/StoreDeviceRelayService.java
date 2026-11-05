package jp.foundr1.store;

import android.app.*;
import android.content.*;
import android.os.IBinder;
import android.os.SystemClock;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/** Outbound-only Store peripheral agent. Unknown sends never print again automatically. */
public class StoreDeviceRelayService extends Service {
    public static volatile boolean running=false;
    public static volatile String message="";
    // Confirmed only by the authenticated server heartbeat, never by a WebView query parameter.
    public static volatile String relayStoreId="",relayStationId="";
    public static volatile long relayVerifiedElapsed=0;
    private final ScheduledExecutorService printWorker=Executors.newSingleThreadScheduledExecutor();
    private final ScheduledExecutorService scaleWorker=Executors.newSingleThreadScheduledExecutor();
    private final AtomicReference<PendingReading> latestReading=new AtomicReference<>();
    private volatile boolean stopped;
    private boolean workersStarted;
    private volatile ScaleContext scaleContext=new ScaleContext("","",-1);
    private long scaleSequence=0,lastHeartbeat=0;
    private String lastScaleState="";
    private long heartbeatIntervalMs=0,nextHeartbeatAttempt=0;
    private volatile long printIntervalMs=3000,nextPrintAt=0;
    private int heartbeatFailures=0;
    private StoreAndBleScale scale;
    private android.os.PowerManager.WakeLock wakeLock;
    private static final String CHANNEL="store-device-relay";
    private static final Object ACK_LOCK=new Object();
    private static final class ScaleContext {
        final String token,session,tareToken;final int epoch;
        ScaleContext(String token,String session,int epoch){this(token,session,epoch,"");}
        ScaleContext(String token,String session,int epoch,String tareToken){this.token=token;this.session=session;this.epoch=epoch;this.tareToken=tareToken;}
        boolean matches(String token,String session,int epoch){return matches(token,session,epoch,"");}
        boolean matches(String token,String session,int epoch,String tareToken){return this.token.equals(token)&&this.session.equals(session)&&this.epoch==epoch&&this.tareToken.equals(tareToken);}
    }
    private static final class PendingReading {
        final String line,session,tareToken;final int epoch;final long receivedElapsed;
        PendingReading(String line,String session,int epoch,long receivedElapsed,String tareToken){this.line=line;this.session=session;this.epoch=epoch;this.receivedElapsed=receivedElapsed;this.tareToken=tareToken;}
    }
    private static final class ApiException extends Exception {
        final int code;
        ApiException(int code){super("設備中継 HTTP "+code);this.code=code;}
    }
    static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences("store_device_relay",MODE_PRIVATE);}
    @Override public void onCreate(){
        super.onCreate();clearTarget();StoreDeviceRelayLifecycle.serviceCreated();
        if(!startRequestedRelay())stopSelf();
    }
    private boolean startRequestedRelay(){
        if(StoreDeviceRelayLifecycle.enabledToken(this).isEmpty())return false;
        if(workersStarted)return true;
        try{
        NotificationManager nm=getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL,"設備中継",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        startForeground(7316,new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Foundr1 設備中継").setContentText("プリンター・電子はかりの接続を待機しています").setContentIntent(open).setOngoing(true).build());
        wakeLock=getSystemService(android.os.PowerManager.class).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK,"Foundr1:DeviceRelay");
        wakeLock.acquire();
        scale=StoreAndBleScale.get(this);scale.setListener(new StoreAndBleScale.Listener(){
            @Override public void onLine(String line,String session,int epoch,long time){onScaleLine(line,session,epoch,time);}
            @Override public void onLine(String line,String session,int epoch,long time,String tareToken){onScaleLine(line,session,epoch,time,tareToken);}
        });
        // Check the newest slot promptly without catch-up runs after a slow request.
        // Network printing can block, so its worker remains separate from scale traffic.
        scaleWorker.scheduleWithFixedDelay(this::scaleTick,0,250,TimeUnit.MILLISECONDS);
        printWorker.scheduleWithFixedDelay(this::printTick,0,3,TimeUnit.SECONDS);
        running=true;workersStarted=true;
        return true;
        }catch(RuntimeException error){
            message="中継を再開できません。Store App を開いて接続を確認してください。";
            return false;
        }
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(!startRequestedRelay()){stopSelf();return START_NOT_STICKY;}
        // Android may recreate a killed sticky foreground service with a null intent.
        return START_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){
        stopped=true;running=false;workersStarted=false;StoreDeviceRelayLifecycle.serviceStopped();clearTarget();latestReading.set(null);
        scaleContext=new ScaleContext("","",-1);
        if(scale!=null){scale.suspend();scale.setListener(null);}
        scaleWorker.shutdownNow();printWorker.shutdownNow();
        if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();
        super.onDestroy();
    }
    private static void clearTarget(){relayVerifiedElapsed=0;relayStoreId="";relayStationId="";}
    private boolean currentToken(String token){return !stopped&&StoreDeviceRelayLifecycle.isCurrentEnabled(this,token);}
    boolean compareAndSetPendingAck(String token,String expected,String replacement){
        synchronized(ACK_LOCK){
            if(!currentToken(token)||!prefs(this).getString("pendingAck","").equals(expected))return false;
            android.content.SharedPreferences.Editor edit=prefs(this).edit();
            if(replacement.isEmpty())edit.remove("pendingAck");else edit.putString("pendingAck",replacement);
            return edit.commit();
        }
    }
    void sendPrintJob(JSONObject payload)throws Exception{Foundr1PrinterBridge.sendRelayNetworkJob(payload.toString());}
    void rejectCredential(String token){
        if(StoreDeviceRelayLifecycle.revokeIfCurrent(this,token))message="中継認証が解除されました。";
    }
    JSONObject call(String token,JSONObject data)throws Exception{
        if(!currentToken(token))throw new IllegalStateException("中継を停止しています。");
        HttpURLConnection c=(HttpURLConnection)new URL("https://www.foundr1.jp/api/store/device-relay/agent").openConnection();
        try{
            c.setInstanceFollowRedirects(false);c.setConnectTimeout(8000);c.setReadTimeout(12000);c.setRequestMethod("POST");c.setDoOutput(true);
            c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Authorization","Bearer "+token);
            try(java.io.OutputStream out=c.getOutputStream()){out.write(data.toString().getBytes(StandardCharsets.UTF_8));}
            int code=c.getResponseCode();
            if(code==401){
                rejectCredential(token);
                throw new ApiException(code);
            }
            if(code!=200)throw new ApiException(code);
            StringBuilder body=new StringBuilder();
            try(java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.InputStreamReader(c.getInputStream(),StandardCharsets.UTF_8))){
                String line;while((line=reader.readLine())!=null){body.append(line);if(body.length()>2_000_000)throw new IllegalStateException("Response too large");}
            }
            return new JSONObject(body.toString());
        }finally{c.disconnect();}
    }
    private void onScaleLine(String line,String session,int epoch,long receivedElapsed){
        onScaleLine(line,session,epoch,receivedElapsed,"");
    }
    private void onScaleLine(String line,String session,int epoch,long receivedElapsed,String tareToken){
        ScaleContext context=scaleContext;
        long age=SystemClock.elapsedRealtime()-receivedElapsed;
        if(stopped||AndScaleReading.parse(line)==null||session.isEmpty()||age<0||age>2000
            ||!currentToken(context.token)||!context.matches(context.token,session,epoch,tareToken))return;
        // Keep one newest sample; a slow request must not create an unbounded upload queue.
        latestReading.set(new PendingReading(line,session,epoch,receivedElapsed,tareToken));
    }
    private void scaleTick(){
        if(stopped)return;
        String token=StoreDeviceRelayLifecycle.enabledToken(this);if(token.isEmpty()){stopSelf();return;}
        if(SystemClock.elapsedRealtime()<nextHeartbeatAttempt)return;
        try{
            long now=SystemClock.elapsedRealtime();
            JSONObject scaleStatus=scale.snapshot();
            String state=scaleStatus.optString("state","not_configured");
            // A POS starts each bowl on the server. Discover that context quickly while
            // idle; active measurements and printer-only stores keep the normal cadence.
            long heartbeatInterval=heartbeatIntervalMs>0?heartbeatIntervalMs:scaleStatus.optBoolean("enabled",false)&&scaleContext.session.isEmpty()?1000:3000;
            if(!token.equals(scaleContext.token)||lastHeartbeat==0||now-lastHeartbeat>=heartbeatInterval||!state.equals(lastScaleState)){
                JSONObject status=new JSONObject().put("printer","unknown").put("scale",state).put("scaleTareVersion",1);
                JSONObject station=call(token,new JSONObject().put("action","heartbeat").put("status",status)).getJSONObject("station");
                if(!currentToken(token))return;
                heartbeatFailures=0;nextHeartbeatAttempt=0;
                heartbeatIntervalMs=station.has("heartbeat_interval_ms")?Math.max(1000,Math.min(15000,station.optLong("heartbeat_interval_ms",3000))):0;
                long nextPrintInterval=Math.max(3000,Math.min(15000,station.optLong("print_interval_ms",3000)));
                if(nextPrintInterval<printIntervalMs)nextPrintAt=Math.min(nextPrintAt,SystemClock.elapsedRealtime()+nextPrintInterval);
                printIntervalMs=nextPrintInterval;
                String storeId=station.getString("store_id"),stationId=station.getString("id");
                String session=station.isNull("scale_session")?"":station.optString("scale_session","");
                int epoch=station.optInt("epoch",-1);
                JSONObject tare=station.optJSONObject("scale_tare_context");
                if(station.has("scale_tare_context")&&!station.isNull("scale_tare_context")&&tare==null)throw new IllegalStateException("Invalid tare context");
                String tareToken=tare==null||tare.length()==0?"":tare.getString("token");
                if(!scaleContext.matches(token,session,epoch,tareToken)){
                    latestReading.set(null);scaleSequence=Math.max(0,station.optLong("scale_sequence",-1));scaleContext=new ScaleContext(token,session,epoch,tareToken);
                }
                scaleSequence=Math.max(scaleSequence,station.optLong("scale_sequence",-1));
                scale.setRelayContext(token,station.optBoolean("scale_enabled",false),session,epoch,tare);
                relayStoreId=storeId;relayStationId=stationId;relayVerifiedElapsed=SystemClock.elapsedRealtime();
                lastHeartbeat=relayVerifiedElapsed;lastScaleState=scale.snapshot().optString("state",state);
            }
            PendingReading reading=latestReading.getAndSet(null);
            ScaleContext context=scaleContext;
            if(reading==null||!context.matches(token,reading.session,reading.epoch,reading.tareToken)||!currentToken(token)
                ||!"connected".equals(scale.snapshot().optString("state")))return;
            long age=SystemClock.elapsedRealtime()-reading.receivedElapsed;
            if(age<0||age>2000)return;
            try{
                JSONObject data=new JSONObject().put("action","reading").put("line",reading.line)
                    .put("scaleSession",reading.session).put("epoch",reading.epoch).put("sequence",++scaleSequence)
                    .put("measuredAt",System.currentTimeMillis()-age);
                if(!reading.tareToken.isEmpty())data.put("tareToken",reading.tareToken);
                call(token,data);
            }catch(ApiException error){
                if(error.code!=409)throw error;
                // Adoption/session changes can overtake one last sample. Refresh the authenticated
                // context next tick; rejecting a sample does not revoke the device's BLE connection.
                latestReading.set(null);lastHeartbeat=0;
                message="計量データを受け付けられませんでした。接続状態を再確認しています。";
            }
        }catch(Exception e){
            if(currentToken(token)){
                heartbeatFailures=Math.min(heartbeatFailures+1,6);
                nextHeartbeatAttempt=SystemClock.elapsedRealtime()+Math.min(60000,1000L<<(heartbeatFailures-1));
                message="電子はかりの通信を確認してください。スマホの日時は自動設定を使用してください。";
                latestReading.set(null);clearTarget();lastHeartbeat=0;
                scaleContext=new ScaleContext(token,"",-1);scale.setRelayContext(token,false,"",-1);
            }
        }
    }
    private void printTick(){
        if(stopped)return;
        String token=StoreDeviceRelayLifecycle.enabledToken(this);if(token.isEmpty()){stopSelf();return;}
        if(relayVerifiedElapsed==0||SystemClock.elapsedRealtime()-relayVerifiedElapsed>15000)return;
        try{
            // Persist before sending. After process death only the ACK is retried, never the print.
            String pending=prefs(this).getString("pendingAck","");
            if(!pending.isEmpty()){
                JSONObject ack=new JSONObject(pending);try{call(token,ack);}catch(ApiException error){if(error.code!=409)throw error;}
                if(!compareAndSetPendingAck(token,pending,""))return;
            }
            if(SystemClock.elapsedRealtime()<nextPrintAt)return;
            nextPrintAt=SystemClock.elapsedRealtime()+printIntervalMs;
            for(int count=0;count<10&&currentToken(token);count++){
                JSONObject response=call(token,new JSONObject().put("action","claim"));
                if(!currentToken(token))return;
                if(response.isNull("job")){message="中継待機中";return;}
                JSONObject job=response.getJSONObject("job");
                JSONObject ack=new JSONObject().put("action","ack").put("jobId",job.getString("id"))
                    .put("claimToken",job.getString("claim_token")).put("result","uncertain").put("error","送信結果を確認してください。");
                String recordedAck=ack.toString();
                if(!compareAndSetPendingAck(token,"",recordedAck))return;
                if(!currentToken(token))return;
                try{
                    sendPrintJob(job.getJSONObject("payload"));
                    ack.put("result","sent").put("error","");message="印刷を送信しました";
                }catch(Exception e){ack.put("error",e.getMessage()==null?"印刷結果を確認できません。":e.getMessage());message="印刷結果を確認してください。";}
                String completedAck=ack.toString();
                if(!compareAndSetPendingAck(token,recordedAck,completedAck))return;
                try{call(token,ack);}catch(ApiException error){if(error.code!=409)throw error;}
                if(!compareAndSetPendingAck(token,completedAck,""))return;
                Thread.sleep(1000);
            }
        }catch(Exception e){if(currentToken(token))message=e.getMessage()==null?"中継通信を確認してください。":e.getMessage();}
    }
}
