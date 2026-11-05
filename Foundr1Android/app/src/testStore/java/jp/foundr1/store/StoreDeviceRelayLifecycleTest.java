package jp.foundr1.store;

import android.app.Application;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.os.Handler;
import android.os.SystemClock;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Delayed;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.util.ReflectionHelpers;
import static org.junit.Assert.*;

/** Real lifecycle and worker bodies with deterministic schedulers/local replies, never live I/O. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
@LooperMode(LooperMode.Mode.PAUSED)
public class StoreDeviceRelayLifecycleTest {
    private static final String OLD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String NEW = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private Context context;
    private RecordingContext commands;
    private final List<ServiceController<RecordingService>> controllers = new ArrayList<>();

    static class RecordingContext extends ContextWrapper {
        final List<String> commands = new ArrayList<>(); boolean blocked;
        RecordingContext(Context base) { super(base); }
        @Override public ComponentName startForegroundService(Intent intent) {
            commands.add("start"); if (blocked) throw new IllegalStateException("background start restricted");
            return new ComponentName(this, StoreDeviceRelayService.class);
        }
        @Override public boolean stopService(Intent intent) { commands.add("stop"); return true; }
    }
    static final class CountingScheduler extends ScheduledThreadPoolExecutor {
        final List<Runnable> tasks = new ArrayList<>();
        final List<Long> initialDelayMillis = new ArrayList<>(), fixedDelayMillis = new ArrayList<>();
        CountingScheduler() { super(1); }
        @Override public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, long delay, long period, TimeUnit unit) {
            tasks.add(task);
            initialDelayMillis.add(unit.toMillis(delay)); fixedDelayMillis.add(unit.toMillis(period));
            return new ScheduledFuture<Object>() {
                public long getDelay(TimeUnit unit) { return 0; }
                public int compareTo(Delayed other) { return 0; }
                public boolean cancel(boolean interrupt) { return true; }
                public boolean isCancelled() { return false; }
                public boolean isDone() { return false; }
                public Object get() { return null; }
                public Object get(long timeout, TimeUnit unit) { return null; }
            };
        }
    }
    public static class RecordingService extends StoreDeviceRelayService {
        final List<String> calls = new ArrayList<>(); final List<JSONObject> payloads = new ArrayList<>();
        CountingScheduler scaleTasks, printTasks; boolean offline; int stops,prints;
        JSONObject nextJob; Runnable beforeAckReturns,duringPrint;
        @Override public boolean stopService(Intent intent) { stops++; return true; }
        @Override JSONObject call(String token, JSONObject data) throws Exception {
            calls.add(data.getString("action")); payloads.add(data);
            if (offline) throw new IOException("local offline fixture");
            if ("heartbeat".equals(data.getString("action"))) return new JSONObject().put("station", new JSONObject()
                .put("store_id", "store-a").put("id", "station-a").put("scale_session", JSONObject.NULL)
                .put("epoch", 3).put("scale_sequence", -1).put("scale_enabled", false));
            if ("claim".equals(data.getString("action"))) {JSONObject job=nextJob;nextJob=null;return new JSONObject().put("job",job==null?JSONObject.NULL:job);}
            if ("ack".equals(data.getString("action"))) {if(beforeAckReturns!=null)beforeAckReturns.run();return new JSONObject().put("ok", true);}
            throw new AssertionError("unexpected agent operation");
        }
        @Override void sendPrintJob(JSONObject payload) {prints++;if(duringPrint!=null)duringPrint.run();}
    }
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication(); commands = new RecordingContext(context);
        StoreDeviceRelayService.prefs(context).edit().clear().commit();
        StoreDeviceRelayService.running = false; StoreDeviceRelayLifecycle.serviceStopped();
    }
    private RecordingService createService() {
        ServiceController<RecordingService> controller = Robolectric.buildService(RecordingService.class);
        RecordingService service = controller.get();
        // Replace executors before onCreate so no timer, network or printer can run by itself.
        ReflectionHelpers.<java.util.concurrent.ScheduledExecutorService>getField(service, "scaleWorker").shutdownNow();
        ReflectionHelpers.<java.util.concurrent.ScheduledExecutorService>getField(service, "printWorker").shutdownNow();
        service.scaleTasks = new CountingScheduler(); service.printTasks = new CountingScheduler();
        ReflectionHelpers.setField(service, "scaleWorker", service.scaleTasks);
        ReflectionHelpers.setField(service, "printWorker", service.printTasks);
        controllers.add(controller); controller.create(); return service;
    }
    @After public void teardown() {
        for (ServiceController<RecordingService> controller : controllers) controller.destroy();
        StoreAndBleScale scale = ReflectionHelpers.getStaticField(StoreAndBleScale.class, "instance");
        if (scale != null) {
            Handler handler = ReflectionHelpers.getField(scale, "handler"); handler.removeCallbacksAndMessages(null);
            context.unregisterReceiver(ReflectionHelpers.getField(scale, "bondReceiver")); handler.getLooper().quitSafely();
            ReflectionHelpers.setStaticField(StoreAndBleScale.class, "instance", null);
        }
        StoreDeviceRelayService.running = false; StoreDeviceRelayLifecycle.serviceStopped();
    }

    @Test public void legacySavedCredentialNeverImpliesAnAutomaticStart() {
        StoreDeviceRelayService.prefs(context).edit().putString("token", OLD).commit();
        assertTrue(StoreDeviceRelayLifecycle.hasSavedConnection(context)); assertFalse(StoreDeviceRelayLifecycle.isRequested(context));
        assertFalse(StoreDeviceRelayLifecycle.resumeIfRequested(commands)); assertTrue(commands.commands.isEmpty());
        RecordingService service = createService(); assertEquals(0, service.scaleTasks.tasks.size());
        assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1));
        assertNull(ReflectionHelpers.getField(service, "scale"));
    }

    @Test public void explicitStartPersistsIntentAndRepeatedResumeDoesNotQueueStarts() {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD);
        assertTrue(StoreDeviceRelayLifecycle.isRequested(context)); assertTrue(StoreDeviceRelayLifecycle.hasSavedConnection(context));
        assertTrue(StoreDeviceRelayLifecycle.resumeIfRequested(commands)); assertTrue(StoreDeviceRelayLifecycle.resumeIfRequested(commands));
        assertEquals(List.of("start"), commands.commands);
        RecordingService service = createService();
        assertEquals(Service.START_STICKY, service.onStartCommand(null, 0, 1));
        assertEquals(Service.START_STICKY, service.onStartCommand(new Intent(), 0, 2));
        assertTrue(StoreDeviceRelayLifecycle.resumeIfRequested(commands));
        assertEquals(1, service.scaleTasks.tasks.size()); assertEquals(1, service.printTasks.tasks.size());
        assertEquals(List.of(0L),service.scaleTasks.initialDelayMillis);
        assertEquals(List.of(250L),service.scaleTasks.fixedDelayMillis);
        assertEquals(List.of(3000L),service.printTasks.fixedDelayMillis);
        assertEquals(List.of("start"), commands.commands);
    }

    @Test public void stickyRecreationWithNullIntentPreservesWantedButWaitsForFreshHeartbeat() {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD); RecordingService first = createService();
        first.scaleTasks.tasks.get(0).run(); assertEquals("store-a", StoreDeviceRelayService.relayStoreId);
        controllers.remove(0).destroy();
        assertTrue(StoreDeviceRelayLifecycle.isRequested(context));
        RecordingService second = createService();
        assertEquals(Service.START_STICKY, second.onStartCommand(null, 0, 1));
        assertEquals("", StoreDeviceRelayService.relayStoreId); assertEquals(0, StoreDeviceRelayService.relayVerifiedElapsed);
        second.printTasks.tasks.get(0).run(); assertTrue(second.calls.isEmpty());
        second.scaleTasks.tasks.get(0).run(); assertEquals(List.of("heartbeat"), second.calls);
    }

    @Test public void explicitStopSurvivesServiceRecreationAndBoot() {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD); RecordingService first = createService();
        StoreDeviceRelayLifecycle.stop(commands);
        assertFalse(StoreDeviceRelayLifecycle.isRequested(context)); assertTrue(StoreDeviceRelayLifecycle.hasSavedConnection(context));
        first.scaleTasks.tasks.get(0).run(); first.printTasks.tasks.get(0).run(); assertTrue(first.calls.isEmpty());
        assertEquals(Service.START_NOT_STICKY, first.onStartCommand(null, 0, 1));
        controllers.remove(0).destroy(); RecordingService next = createService();
        assertTrue(next.scaleTasks.tasks.isEmpty()); assertEquals(Service.START_NOT_STICKY, next.onStartCommand(null, 0, 2));
        new StoreDeviceRelayBootReceiver().onReceive(commands, new Intent(Intent.ACTION_BOOT_COMPLETED));
        assertEquals(List.of("start", "stop"), commands.commands);
    }

    @Test public void invalidTokenCannotStartEvenIfWantedWasStored() {
        StoreDeviceRelayService.prefs(context).edit().putString("token", "invalid").putBoolean("wanted", true).commit();
        assertFalse(StoreDeviceRelayLifecycle.hasSavedConnection(context)); assertFalse(StoreDeviceRelayLifecycle.resumeIfRequested(commands));
        RecordingService service = createService(); assertTrue(service.scaleTasks.tasks.isEmpty());
        assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1));
        try { StoreDeviceRelayLifecycle.enableAndStart(commands, "invalid"); fail("invalid token accepted"); }
        catch (IllegalArgumentException expected) {}
    }

    @Test public void currentCredentialRevocationStopsButLateOld401LeavesNewBindingRunning() {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD); RecordingService service = createService();
        StoreDeviceRelayLifecycle.enableAndStart(commands, NEW);
        service.rejectCredential(OLD); assertEquals(0, service.stops);
        assertTrue(StoreDeviceRelayLifecycle.isCurrentEnabled(context, NEW));
        service.rejectCredential(NEW); assertEquals(1, service.stops);
        assertFalse(StoreDeviceRelayLifecycle.isRequested(context)); assertFalse(StoreDeviceRelayLifecycle.resumeIfRequested(commands));
        service.scaleTasks.tasks.get(0).run(); assertTrue(service.calls.isEmpty());
    }

    @Test public void stopAndExplicitStartKeepTheirCommandOrderWhileOldRevocationDoesNothing() {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD); StoreDeviceRelayLifecycle.stop(commands);
        StoreDeviceRelayLifecycle.enableAndStart(commands, NEW);
        assertFalse(StoreDeviceRelayLifecycle.revokeIfCurrent(commands, OLD));
        assertEquals(List.of("start", "stop", "start"), commands.commands);
        assertTrue(StoreDeviceRelayLifecycle.isCurrentEnabled(context, NEW));
    }

    @Test public void offlineRetryPreservesWantedAndCredentialWithoutRebinding() {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD); RecordingService service = createService();
        service.offline = true; service.scaleTasks.tasks.get(0).run();
        assertTrue(StoreDeviceRelayLifecycle.isCurrentEnabled(context, OLD)); assertEquals(0, StoreDeviceRelayService.relayVerifiedElapsed);
        service.offline = false; SystemClock.sleep(1000); service.scaleTasks.tasks.get(0).run();
        assertEquals(List.of("heartbeat", "heartbeat"), service.calls); assertEquals("store-a", StoreDeviceRelayService.relayStoreId);
        assertEquals(List.of("start"), commands.commands);
    }

    @Test public void rebootAndPackageReplacementOnlyResumeExplicitlyEnabledConnections() {
        StoreDeviceRelayBootReceiver receiver = new StoreDeviceRelayBootReceiver();
        receiver.onReceive(commands, null); receiver.onReceive(commands, new Intent("unrelated.action"));
        receiver.onReceive(commands, new Intent(Intent.ACTION_BOOT_COMPLETED)); assertTrue(commands.commands.isEmpty());
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD); StoreDeviceRelayLifecycle.serviceStopped();
        receiver.onReceive(commands, new Intent(Intent.ACTION_BOOT_COMPLETED));
        receiver.onReceive(commands, new Intent(Intent.ACTION_MY_PACKAGE_REPLACED));
        assertEquals(List.of("start", "start"), commands.commands);
        StoreDeviceRelayLifecycle.stop(commands); receiver.onReceive(commands, new Intent(Intent.ACTION_MY_PACKAGE_REPLACED));
        assertEquals(List.of("start", "start", "stop"), commands.commands);
    }

    @Test public void backgroundStartRejectionKeepsIntentForLaterForegroundResume() {
        StoreDeviceRelayService.prefs(context).edit().putString("token", OLD).putBoolean("wanted", true).commit();
        commands.blocked = true; assertFalse(StoreDeviceRelayLifecycle.resumeIfRequested(commands));
        assertTrue(StoreDeviceRelayLifecycle.isCurrentEnabled(context, OLD));
        commands.blocked = false; assertTrue(StoreDeviceRelayLifecycle.resumeIfRequested(commands));
        assertEquals(List.of("start", "start"), commands.commands);
    }

    @Test public void uncertainPrintAcknowledgementSurvivesRestartAndNeverReprints() throws Exception {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD);
        JSONObject pending = new JSONObject().put("action", "ack").put("result", "uncertain").put("jobId", "job-old").put("claimToken", "claim-old");
        StoreDeviceRelayService.prefs(context).edit().putString("pendingAck", pending.toString()).commit();
        RecordingService service = createService(); service.scaleTasks.tasks.get(0).run(); service.printTasks.tasks.get(0).run();
        assertEquals(List.of("heartbeat", "ack", "claim"), service.calls);
        assertEquals("uncertain", service.payloads.get(1).getString("result"));
        assertFalse(StoreDeviceRelayService.prefs(context).contains("pendingAck"));
    }

    @Test public void aDelayedOldAckCannotEraseAReplacementServicesPendingJournal() throws Exception {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD);
        RecordingService old=createService(),replacement=createService();
        String first=new JSONObject().put("action","ack").put("jobId","job-a").put("claimToken","claim-a").put("result","sent").toString();
        String next=new JSONObject().put("action","ack").put("jobId","job-b").put("claimToken","claim-b").put("result","uncertain").toString();
        assertTrue(old.compareAndSetPendingAck(OLD,"",first));
        old.beforeAckReturns=()->assertTrue(replacement.compareAndSetPendingAck(OLD,first,next));
        old.scaleTasks.tasks.get(0).run();old.printTasks.tasks.get(0).run();
        assertEquals(List.of("heartbeat","ack"),old.calls);
        assertEquals(next,StoreDeviceRelayService.prefs(context).getString("pendingAck",""));
        assertEquals(0,old.prints);
    }

    @Test public void aLateOldPrintResultCannotOverwriteAReplacementServicesPendingJournal() throws Exception {
        StoreDeviceRelayLifecycle.enableAndStart(commands, OLD);
        RecordingService old=createService(),replacement=createService();
        String next=new JSONObject().put("action","ack").put("jobId","job-b").put("claimToken","claim-b").put("result","uncertain").toString();
        old.nextJob=new JSONObject().put("id","job-a").put("claim_token","claim-a").put("payload",new JSONObject());
        old.duringPrint=()->{
            String journal=StoreDeviceRelayService.prefs(context).getString("pendingAck","");
            assertTrue(journal.contains("job-a"));assertTrue(replacement.compareAndSetPendingAck(OLD,journal,next));
        };
        old.scaleTasks.tasks.get(0).run();old.printTasks.tasks.get(0).run();
        assertEquals(List.of("heartbeat","claim"),old.calls);assertEquals(1,old.prints);
        assertEquals(next,StoreDeviceRelayService.prefs(context).getString("pendingAck",""));
    }
}
