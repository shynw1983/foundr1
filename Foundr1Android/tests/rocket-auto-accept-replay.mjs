// Replay the production worker against captured Flutter semantics, without a tablet/order.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const tmp = mkdtempSync(join(tmpdir(), 'rocket-replay-'));
const javaHome = process.env.JAVA_HOME;
const binary = name => javaHome ? join(javaHome, 'bin', name) : name;
const sources = {
'android/content/SharedPreferences.java': `package android.content;
public interface SharedPreferences { long getLong(String k,long d); Editor edit(); interface Editor { Editor putLong(String k,long v); Editor remove(String k); boolean commit(); void apply(); } }`,
'android/content/Context.java': `package android.content;
public class Context { public SharedPreferences prefs; public SharedPreferences getSharedPreferences(String name,int mode){return prefs;} }`,
'android/accessibilityservice/AccessibilityService.java': `package android.accessibilityservice;
import android.view.accessibility.AccessibilityNodeInfo;
public class AccessibilityService extends android.content.Context { public AccessibilityNodeInfo root; public AccessibilityNodeInfo getRootInActiveWindow(){return root;} }`,
'android/os/Looper.java': `package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }`,
'android/os/Handler.java': `package android.os; public class Handler { public Handler(Looper l){} public void post(Runnable r){} public void postDelayed(Runnable r,long t){} public void removeCallbacks(Runnable r){} }`,
'android/os/SystemClock.java': `package android.os; public class SystemClock { public static long now=10000; public static long elapsedRealtime(){return now;} }`,
'android/util/Log.java': `package android.util; public class Log { public static int i(String tag,String value){return 0;} }`,
'android/view/accessibility/AccessibilityNodeInfo.java': `package android.view.accessibility;
import java.util.*;
public class AccessibilityNodeInfo {
 public static final int ACTION_CLICK=16;
 public String desc="", text="", pkg="com.cpone.merchant";
 public boolean visible=true, enabled=true, clickable=false, stale=false;
 public Runnable action; public int clicks;
 public List<AccessibilityNodeInfo> children=new ArrayList<>();
 public CharSequence getPackageName(){return pkg;}
 public CharSequence getText(){return text;} public CharSequence getContentDescription(){return desc;}
 public boolean isVisibleToUser(){return visible;} public boolean isEnabled(){return enabled;} public boolean isClickable(){return clickable;}
 public int getChildCount(){return children.size();} public AccessibilityNodeInfo getChild(int i){return children.get(i);}
 public static AccessibilityNodeInfo obtain(AccessibilityNodeInfo n){return n;}
 public void recycle(){} public boolean refresh(){return !stale;}
 public boolean performAction(int a){clicks++;if(action!=null)action.run();return true;}
}`,
'jp/foundr1/store/bridge/BridgeConfig.java': `package jp.foundr1.store.bridge;
class BridgeConfig { static final String ROCKET_NOW_PACKAGE="com.cpone.merchant", PLATFORM_ROCKET_NOW="rocket_now";
 static Flag prefs(android.content.Context c){return new Flag();} static boolean supportsPlatform(android.content.Context c,String p){return true;}
 static class Flag { boolean getBoolean(String k,boolean d){return true;} }
}`,
'jp/foundr1/store/bridge/BridgeCommandState.java': `package jp.foundr1.store.bridge; class BridgeCommandState { static Object current(android.content.Context c){return null;} }`,
'jp/foundr1/store/bridge/BridgeCrashReporter.java': `package jp.foundr1.store.bridge; class BridgeCrashReporter { static void reportCaught(android.content.Context c,String s,RuntimeException e){throw e;} }`,
'jp/foundr1/store/bridge/RocketReplay.java': `package jp.foundr1.store.bridge;
import android.view.accessibility.AccessibilityNodeInfo;
import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.os.SystemClock;
import java.util.*;
import java.lang.reflect.*;
import javax.xml.parsers.*;
import org.w3c.dom.*;
public class RocketReplay {
 static String fixture;
 static Method inspect;
 static class Prefs implements SharedPreferences, SharedPreferences.Editor {
  Map<String,Long> values=new HashMap<>(); public long getLong(String k,long d){return values.getOrDefault(k,d);}
  public Editor edit(){return this;} public Editor putLong(String k,long v){values.put(k,v);return this;}
  public Editor remove(String k){values.remove(k);return this;} public boolean commit(){return true;} public void apply(){}
 }
 static AccessibilityNodeInfo node(String label,boolean click){var n=new AccessibilityNodeInfo();n.desc=label;n.clickable=click;return n;}
 static AccessibilityNodeInfo xml(Element e){
  var n=node(e.getAttribute("content-desc"),"true".equals(e.getAttribute("clickable")));
  n.text=e.getAttribute("text");n.enabled="true".equals(e.getAttribute("enabled"));
  var children=e.getChildNodes();for(int i=0;i<children.getLength();i++)if(children.item(i) instanceof Element)n.children.add(xml((Element)children.item(i)));
  return n;
 }
 static AccessibilityNodeInfo dialog() throws Exception {return xml(DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(fixture).getDocumentElement());}
 static AccessibilityNodeInfo find(AccessibilityNodeInfo n,String label){if(n.desc.equals(label))return n;for(var c:n.children){var found=find(c,label);if(found!=null)return found;}return null;}
 static AccessibilityService service(AccessibilityNodeInfo dialog){
  var s=new AccessibilityService();s.prefs=new Prefs();s.root=node("",false);
  if(dialog!=null)s.root.children.add(dialog);
  s.root.children.add(node("T3ST01",false));s.root.children.add(node("新規注文",false));return s;
 }
 static void step(RocketAutoAccept worker) throws Exception {SystemClock.now+=1000;inspect.invoke(worker);}
 static void check(boolean v,String message){if(!v)throw new AssertionError(message);}
 static void setTime(AccessibilityNodeInfo d,int value,boolean limit){
  d.desc="予想調理時間の変更\\n予想調理時間を入力してください。\\n"+value+"分\\n推奨時間 13分"+(limit?"\\n調理時間は上限に達しています。":"");
  find(d,"+5").enabled=!limit;find(d,"+1").enabled=!limit;
 }
 public static void main(String[] args)throws Exception{
  fixture=args[0]; inspect=RocketAutoAccept.class.getDeclaredMethod("inspect");inspect.setAccessible(true);
  var d=dialog();var s=service(d);var w=new RocketAutoAccept(s);
  var five=find(d,"+5");var accept=find(d,"注文を受諾する");
  step(w);check(five.clicks==1,"Captured merged Flutter dialog must add time");
  step(w);check(five.clicks==1,"Unchanged frame must not duplicate +5");
  setTime(d,18,false);step(w);check(five.clicks==2,"18 minutes needs one more +5");
  setTime(d,23,true);step(w);check(accept.clicks==1,"23-minute limit must accept");
  step(w);step(new RocketAutoAccept(s));check(accept.clicks==1,"Persisted dispatch prevents duplicate acceptance on restart");
  s.root=node("",false);
  var success=node("T3ST01 注文受諾完了",false);s.root.children.add(success);
  var management=node("注文管理\\nタブ: 2/3",true);s.root.children.add(management);
  step(w);check(management.clicks==0,"Wait for the acceptance confirmation popup to close");
  s.root.children.remove(success);step(w);step(w);
  check(management.clicks==1,"Confirmed acceptance opens order management once");
  var unrelated=node("T3ST02\\n[メニュー 1個] 100円",true);s.root.children.add(unrelated);
  var target=node("T3ST01\\n[メニュー 1個] 100円",true);s.root.children.add(target);
  step(w);step(w);check(target.clicks==1&&unrelated.clicks==0,"Only open the accepted order card once");
  s.root.children.add(node("T3ST01",false));s.root.children.add(node("メニュー",false));
  s.root.children.add(node("数量",false));s.root.children.add(node("金額",false));
  step(w);check(target.clicks==1,"Stop navigation once matching details are available for upload");
  d=dialog();s=service(d);w=new RocketAutoAccept(s);five=find(d,"+5");accept=find(d,"注文を受諾する");
  step(w);setTime(d,13,true);step(w);check(accept.clicks==1,"Limit acknowledgement without time change must not stall");
  d=dialog();setTime(d,23,true);s=service(d);w=new RocketAutoAccept(s);accept=find(d,"注文を受諾する");accept.stale=true;
  step(w);check(accept.clicks==0,"Stale/replaced accept node must not be clicked");
  d=dialog();s=service(d);s.root.children.add(1,dialog());w=new RocketAutoAccept(s);five=find(d,"+5");
  step(w);setTime(d,18,false);step(w);check(five.clicks==2,"Underlying 13-minute dialog must not conflict with active 18-minute dialog");
  s=service(null);var open=node("調理時間変更",true);s.root.children.add(open);w=new RocketAutoAccept(s);
  step(w);step(w);step(w);check(open.clicks==1,"Opening a dialog must be dispatched once while response is pending");
  s=service(dialog());s.root.pkg="another.app";w=new RocketAutoAccept(s);step(w);
  check(find(s.root,"+5").clicks==0,"Never operate another app");
  System.out.println("PASS: captured dialog, 13→18→23, unchanged frames, limit rejection, stale controls, stacked dialogs, restart, package guard, confirmed acceptance to matching order details");
 }
}`
};
try {
 const files=[];
 for(const [name,body] of Object.entries(sources)) {const file=join(tmp,name);mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,body);files.push(file);}
 const src=resolve('Foundr1Android/app/src/bridge/java/jp/foundr1/store/bridge');
 execFileSync(binary('javac'),['-d',tmp,...files,join(src,'RocketAutoAccept.java'),join(src,'RocketAcceptPolicy.java')],{stdio:'inherit',timeout:30000});
 execFileSync(binary('java'),['-cp',tmp,'jp.foundr1.store.bridge.RocketReplay',resolve('Foundr1Android/tests/fixtures/rocket-time-dialog.xml')],{stdio:'inherit',timeout:15000});
} finally {rmSync(tmp,{recursive:true,force:true});}
