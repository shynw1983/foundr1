// Exercise the production worker against Uber's captured status/duration UI, offline.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const tmp = mkdtempSync(join(tmpdir(), 'uber-busy-replay-'));
const binary = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name) : name;
const sources = {
'android/content/Context.java': `package android.content; public class Context {}`,
'android/accessibilityservice/AccessibilityService.java': `package android.accessibilityservice;
import android.view.accessibility.AccessibilityNodeInfo;
public class AccessibilityService extends android.content.Context { public AccessibilityNodeInfo root; public AccessibilityNodeInfo getRootInActiveWindow(){return root;} }`,
'android/os/Looper.java': `package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }`,
'android/os/Handler.java': `package android.os; public class Handler { public Handler(Looper l){} public void post(Runnable r){} public void postDelayed(Runnable r,long t){} public void removeCallbacks(Runnable r){} }`,
'android/os/SystemClock.java': `package android.os; public class SystemClock { public static long now=10000; public static long uptimeMillis(){return now;} public static long elapsedRealtime(){return now;} }`,
'android/util/Log.java': `package android.util; public class Log { public static int i(String tag,String value){return 0;} }`,
'android/view/accessibility/AccessibilityEvent.java': `package android.view.accessibility;
public class AccessibilityEvent { public static final int TYPE_TOUCH_INTERACTION_START=1,TYPE_TOUCH_INTERACTION_END=2,TYPE_VIEW_SCROLLED=3,TYPE_VIEW_TEXT_CHANGED=4,TYPE_VIEW_CLICKED=5; public String pkg="com.uber.restaurants"; public int type; public CharSequence getPackageName(){return pkg;} public int getEventType(){return type;} }`,
'android/view/accessibility/AccessibilityNodeInfo.java': `package android.view.accessibility;
import java.util.*;
public class AccessibilityNodeInfo {
 public static final int ACTION_CLICK=16;
 public String text="", id="", pkg="com.uber.restaurants";
 public boolean visible=true, enabled=true, clickable=false, stale=false, selected=false, checked=false;
 public Runnable action; public int clicks; public AccessibilityNodeInfo parent;
 public List<AccessibilityNodeInfo> children=new ArrayList<>();
 public CharSequence getPackageName(){return pkg;} public CharSequence getText(){return text;} public String getViewIdResourceName(){return id;}
 public boolean isVisibleToUser(){return visible;} public boolean isEnabled(){return enabled;} public boolean isClickable(){return clickable;}
 public boolean isSelected(){return selected;} public boolean isChecked(){return checked;} public AccessibilityNodeInfo getParent(){return parent;}
 public int getChildCount(){return children.size();} public AccessibilityNodeInfo getChild(int i){return children.get(i);}
 public List<AccessibilityNodeInfo> findAccessibilityNodeInfosByViewId(String target){var out=new ArrayList<AccessibilityNodeInfo>();if(!visible)return out;if(id.equals(target))out.add(this);for(var c:children)out.addAll(c.findAccessibilityNodeInfosByViewId(target));return out;}
 public static AccessibilityNodeInfo obtain(AccessibilityNodeInfo n){return n;} public void recycle(){} public boolean refresh(){return !stale;}
 public boolean performAction(int a){clicks++;if(action!=null)action.run();return true;}
}`,
'jp/foundr1/store/bridge/BridgeConfig.java': `package jp.foundr1.store.bridge;
class BridgeConfig { static final String UBER_ORDERS_PACKAGE="com.uber.restaurants", PLATFORM_UBER_EATS="uber_eats";
 static boolean enabled=true,supported=true; static Flag prefs(android.content.Context c){return new Flag();} static boolean supportsPlatform(android.content.Context c,String p){return supported;}
 static class Flag { boolean getBoolean(String k,boolean d){return enabled;} }
}`,
'jp/foundr1/store/bridge/BridgeCommandState.java': `package jp.foundr1.store.bridge; class BridgeCommandState { static boolean active; static Object current(android.content.Context c){return active?new Object():null;} }`,
'jp/foundr1/store/bridge/UberRecoveryState.java': `package jp.foundr1.store.bridge; class UberRecoveryState { static boolean pending; static boolean isPending(android.content.Context c){return pending;} }`,
'jp/foundr1/store/bridge/BridgeCrashReporter.java': `package jp.foundr1.store.bridge; class BridgeCrashReporter { static void reportCaught(android.content.Context c,String s,RuntimeException e){throw e;} }`,
'jp/foundr1/store/bridge/UberBusyReplay.java': `package jp.foundr1.store.bridge;
import android.view.accessibility.*; import android.accessibilityservice.AccessibilityService; import android.os.SystemClock;
import java.util.*; import java.lang.reflect.*; import javax.xml.parsers.*; import org.w3c.dom.*;
public class UberBusyReplay {
 static String statusFile,pickerFile; static Method run; static int changes, normalChanges;
 static final String HEADER="ub__ueo_order_header_status_button", APPLY="ub__ueo_store_status_duration_button";
 static AccessibilityNodeInfo xml(Element e){
  var n=new AccessibilityNodeInfo();n.text=e.getAttribute("text");n.id=e.getAttribute("resource-id");
  n.enabled=!"false".equals(e.getAttribute("enabled"));n.clickable="true".equals(e.getAttribute("clickable"));n.selected="true".equals(e.getAttribute("selected"));n.checked="true".equals(e.getAttribute("checked"));
  var cs=e.getChildNodes();for(int i=0;i<cs.getLength();i++)if(cs.item(i) instanceof Element){var c=xml((Element)cs.item(i));c.parent=n;n.children.add(c);}return n;
 }
 static AccessibilityNodeInfo load(String path){try{return xml(DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(path).getDocumentElement());}catch(Exception e){throw new RuntimeException(e);}}
 static AccessibilityNodeInfo id(AccessibilityNodeInfo n,String id){if(n.id.equals("com.uber.restaurants:id/"+id))return n;for(var c:n.children){var f=id(c,id);if(f!=null)return f;}return null;}
 static AccessibilityNodeInfo label(AccessibilityNodeInfo n,String label){if(n.text.replaceAll("[\\\\s\\u00a0]+","").equals(label))return n;for(var c:n.children){var f=label(c,label);if(f!=null)return f;}return null;}
 static AccessibilityNodeInfo row(AccessibilityNodeInfo n){while(n!=null&&!n.clickable)n=n.parent;return n;}
 static AccessibilityNodeInfo overview(String state){var n=load(statusFile);id(n,"ub__ueo_modal_sheet_content_container").visible=false;id(n,HEADER).text=state;return n;}
 static AccessibilityService service(){BridgeConfig.enabled=true;BridgeConfig.supported=true;BridgeCommandState.active=false;UberRecoveryState.pending=false;changes=0;normalChanges=0;var s=new AccessibilityService();s.root=overview("営業中");wireOverview(s);return s;}
 static void wireOverview(AccessibilityService s){final String state=id(s.root,HEADER).text;id(s.root,HEADER).action=()->{s.root=load(statusFile);id(s.root,HEADER).text=state;row(label(s.root,"営業中")).action=()->{normalChanges++;s.root=overview("営業中");wireOverview(s);};row(label(s.root,"混雑中")).action=()->{s.root=load(pickerFile);row(label(s.root,"30分以上")).action=()->{label(s.root,"30分以上").selected=true;id(s.root,APPLY).enabled=true;};id(s.root,APPLY).action=()->{changes++;s.root=overview("混雑中：");wireOverview(s);};};};}
 static UberBusyModeKeeper worker(AccessibilityService s){var w=new UberBusyModeKeeper(s);w.start();return w;}
 static void step(UberBusyModeKeeper w)throws Exception{SystemClock.now+=500;run.invoke(w);}
 static void check(boolean b,String message){if(!b)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception{
  statusFile=args[0];pickerFile=args[1];run=UberBusyModeKeeper.class.getDeclaredMethod("run");run.setAccessible(true);
  var s=service();var w=worker(s);for(int i=0;i<6;i++)step(w);check(changes==1&&!w.isNavigating(),"Normal→busy→30 selected→apply→confirmed");
  for(int i=0;i<8;i++)step(w);check(changes==1,"Already busy must never toggle to normal or refresh repeatedly");
  for(String state:new String[]{"混雑中：","一時停止","営業時間外","閉店中","Unknown"}){s=service();s.root=overview(state);w=worker(s);step(w);check(id(s.root,HEADER).clicks==0,"Leave non-normal states alone: "+state);}
  s=service();BridgeConfig.enabled=false;w=worker(s);step(w);check(id(s.root,HEADER).clicks==0,"Off by default/disabled");
  s=service();BridgeConfig.supported=false;w=worker(s);step(w);check(id(s.root,HEADER).clicks==0,"Platform guard");
  s=service();s.root.pkg="com.cpone.merchant";w=worker(s);step(w);check(id(s.root,HEADER).clicks==0,"Package guard");
  s=service();BridgeCommandState.active=true;w=worker(s);step(w);check(id(s.root,HEADER).clicks==0,"Inventory command priority");
  s=service();UberRecoveryState.pending=true;w=worker(s);step(w);check(id(s.root,HEADER).clicks==0,"Order capture priority");
  s=service();s.root=load(pickerFile);w=worker(s);step(w);check(row(label(s.root,"30分以上")).clicks==0,"Never change employee-owned picker or restart into one");
  s=service();id(s.root,HEADER).stale=true;w=worker(s);step(w);check(id(s.root,HEADER).clicks==0,"Stale nodes are not clicked");
  s=service();var header=id(s.root,HEADER);header.action=null;w=worker(s);step(w);for(int i=0;i<10;i++)step(w);check(header.clicks==1,"Unchanged frame never repeats a click");SystemClock.now+=16000;step(w);step(w);check(!w.isNavigating()&&header.clicks==1,"Timeout backs off without repeated actions");
  s=service();w=worker(s);step(w);step(w);var thirty=row(label(s.root,"30分以上"));thirty.action=null;id(s.root,APPLY).enabled=true;step(w);step(w);check(id(s.root,APPLY).clicks==0,"Do not apply when the 30-minute selection is not confirmed");
  s=service();w=worker(s);var touch=new AccessibilityEvent();touch.type=AccessibilityEvent.TYPE_TOUCH_INTERACTION_END;w.onEvent(touch);step(w);check(id(s.root,HEADER).clicks==0,"Give staff interaction priority");SystemClock.now+=1500;step(w);check(w.isNavigating(),"Resume after brief interaction delay");
  final var preempt=service();var preemptWorker=worker(preempt);step(preemptWorker);step(preemptWorker);
  id(preempt.root,"ub__ueo_store_status_duration_header_back_button").action=()->{preempt.root=load(statusFile);id(preempt.root,"ub__ueo_store_status_modal_sheet_header_back_button").action=()->{preempt.root=overview("営業中");};};
  UberRecoveryState.pending=true;step(preemptWorker);step(preemptWorker);step(preemptWorker);
  check(!preemptWorker.isNavigating()&&changes==0,"New order closes both owned modal levels before yielding, without applying a setting");
  s=service();w=worker(s);step(w);SystemClock.now+=1000;var ownClick=new AccessibilityEvent();ownClick.type=AccessibilityEvent.TYPE_VIEW_CLICKED;w.onEvent(ownClick);step(w);check(id(s.root,"ub__ueo_store_status_duration_header_title")!=null,"Delayed accessibility events from our own click must not introduce a manual-interaction wait");
  s=service();var duplicate=new AccessibilityNodeInfo();duplicate.id="com.uber.restaurants:id/"+HEADER;duplicate.text="営業中";s.root.children.add(duplicate);w=worker(s);step(w);check(id(s.root,HEADER).clicks==0,"Ambiguous status controls fail closed");
  // Advance the actual production clock, retaining the same worker across cycles.
  s=service();s.root=overview("混雑中：");wireOverview(s);w=worker(s);step(w);
  SystemClock.now+=UberBusyModeKeeper.REFRESH_INTERVAL_MS-1000;step(w);
  check(normalChanges==0&&!w.isNavigating(),"No reset before 55 minutes");
  step(w);for(int i=0;i<9;i++)step(w);
  check(normalChanges==1&&changes==1&&!w.isNavigating(),"55-minute busy→normal→busy refresh completes");
  for(int i=0;i<8;i++)step(w);check(normalChanges==1,"Successful refresh cannot loop immediately");
  SystemClock.now+=UberBusyModeKeeper.REFRESH_INTERVAL_MS;for(int i=0;i<10;i++)step(w);
  check(normalChanges==2&&changes==2&&!w.isNavigating(),"Repeat refresh after next 55 minutes");
  s=service();w=worker(s);for(int i=0;i<6;i++)step(w);
  SystemClock.now+=30L*60*1000;s.root=overview("営業中");wireOverview(s);for(int i=0;i<6;i++)step(w);
  SystemClock.now+=25L*60*1000;for(int i=0;i<10;i++)step(w);
  check(changes==2&&normalChanges==0,"Normal recovery renews the 55-minute deadline");
  SystemClock.now+=30L*60*1000;for(int i=0;i<10;i++)step(w);
  check(changes==3&&normalChanges==1,"Fallback occurs 55 minutes after the latest confirmed normal recovery");
  for(String state:new String[]{"一時停止","営業時間外","閉店中","Unknown"}){
   s=service();s.root=overview(state);w=worker(s);step(w);SystemClock.now+=UberBusyModeKeeper.REFRESH_INTERVAL_MS;step(w);
   check(id(s.root,HEADER).clicks==0,"Due fallback leaves inactive/unknown status alone: "+state);
  }
  s=service();s.root=overview("混雑中：");wireOverview(s);w=worker(s);step(w);
  SystemClock.now+=UberBusyModeKeeper.REFRESH_INTERVAL_MS;BridgeCommandState.active=true;step(w);
  check(id(s.root,HEADER).clicks==0,"Due refresh defers for commands");BridgeCommandState.active=false;
  UberRecoveryState.pending=true;step(w);check(id(s.root,HEADER).clicks==0,"Due refresh defers for orders");UberRecoveryState.pending=false;
  var dueTouch=new AccessibilityEvent();dueTouch.type=AccessibilityEvent.TYPE_TOUCH_INTERACTION_END;w.onEvent(dueTouch);step(w);
  check(id(s.root,HEADER).clicks==0,"Due refresh defers for employee touch");SystemClock.now+=1500;step(w);step(w);
  check(normalChanges==1,"Due refresh resumes after higher-priority work");
  // A dispatched normal click with a stale busy header must never apply busy yet.
  s=service();s.root=overview("混雑中：");wireOverview(s);w=worker(s);step(w);
  SystemClock.now+=UberBusyModeKeeper.REFRESH_INTERVAL_MS;step(w);
  var normalRow=row(label(s.root,"営業中"));normalRow.action=null;step(w);for(int i=0;i<8;i++)step(w);
  check(normalRow.clicks==1&&changes==0,"Wait for confirmed normal; never repeat click on stale UI");
  // A delayed normal response inside the timeout still completes safely.
  s.root=overview("営業中");wireOverview(s);for(int i=0;i<7;i++)step(w);
  check(changes==1&&!w.isNavigating(),"Delayed normal confirmation resumes the busy refresh");
  s=service();s.root=overview("混雑中：");wireOverview(s);w=worker(s);step(w);
  SystemClock.now+=UberBusyModeKeeper.REFRESH_INTERVAL_MS;step(w);
  row(label(s.root,"営業中")).action=null;step(w);
  SystemClock.now+=31000;step(w);check(changes==0,"Slow/stale reset times out without applying busy");
  s.root=overview("混雑中：");wireOverview(s);step(w);SystemClock.now+=31000;
  for(int i=0;i<10;i++)step(w);check(changes==1&&normalChanges==1,"Failed refresh remains due after backoff; failure does not renew deadline");
  // Disabled mode cancels the timer; enabling starts a fresh full interval.
  s=service();s.root=overview("混雑中：");wireOverview(s);w=worker(s);step(w);
  BridgeConfig.enabled=false;SystemClock.now+=UberBusyModeKeeper.REFRESH_INTERVAL_MS;step(w);
  BridgeConfig.enabled=true;step(w);check(id(s.root,HEADER).clicks==0,"Re-enabled timer starts with 55 minutes");
  System.out.println("PASS: captured Uber UI, 30-minute selection, busy confirmation, repeated 55-minute reset, deadline renewal, slow normal confirmation, paused/closed/package/platform guards, disabled setting, order/command priority, manual dialog, stale nodes, unchanged frames, timeout backoff, unconfirmed selection, staff interaction");
 }
}`
};
try {
 const files=[];
 for(const [name,body] of Object.entries(sources)){const file=join(tmp,name);mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,body);files.push(file);}
 execFileSync(binary('javac'),['-d',tmp,...files,resolve('Foundr1Android/app/src/bridge/java/jp/foundr1/store/bridge/UberBusyModeKeeper.java')],{stdio:'inherit',timeout:30000});
 execFileSync(binary('java'),['-cp',tmp,'jp.foundr1.store.bridge.UberBusyReplay',resolve('Foundr1Android/tests/fixtures/uber-store-status.xml'),resolve('Foundr1Android/tests/fixtures/uber-busy-duration.xml')],{stdio:'inherit',timeout:15000});
} finally {rmSync(tmp,{recursive:true,force:true});}
