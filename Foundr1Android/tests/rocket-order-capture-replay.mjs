// Exercise the production capture guards with sanitized, recorded device nodes.
import {readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';

const tmp=mkdtempSync(join(tmpdir(),'rocket-capture-'));
const source=readFileSync('Foundr1Android/app/src/bridge/java/jp/foundr1/store/bridge/UberAccessibilityService.java','utf8');
const methods=source.slice(source.indexOf('    private boolean containsRocketOrderDetails('),source.indexOf('    private void mergeRocketNodes('))
  .replaceAll('private boolean containsRocketOrderDetails','boolean containsRocketOrderDetails')
  .replaceAll('private String extractRocketDetailOrderCode','String extractRocketDetailOrderCode');
const fixtures=JSON.parse(readFileSync('lib/fixtures/rocket-order-snapshots.json','utf8'));
const snapshots=fixtures.map(e=>'snapshot(new String[][]{'+e.nodes.map(n=>'{'+JSON.stringify(n.path)+','+JSON.stringify(n.contentDescription)+'}').join(',')+'})');
const files={
  'org/json/JSONObject.java':`package org.json; import java.util.*; public class JSONObject {
    Map<String,String> values=new HashMap<>(); public JSONObject put(String k,String v){values.put(k,v);return this;}
    public String optString(String k){return values.getOrDefault(k,"");} }`,
  'org/json/JSONArray.java':`package org.json; import java.util.*; public class JSONArray {
    List<JSONObject> values=new ArrayList<>(); public JSONArray put(JSONObject v){values.add(v);return this;}
    public int length(){return values.size();} public JSONObject optJSONObject(int i){return values.get(i);} }`,
  'jp/foundr1/store/bridge/RocketCaptureReplay.java':`package jp.foundr1.store.bridge;
    import org.json.*; import java.util.*;
    public class RocketCaptureReplay {
      ${methods}
      static JSONArray snapshot(String[][] rows){var result=new JSONArray();for(var r:rows)result.put(new JSONObject().put("path",r[0]).put("contentDescription",r[1]));return result;}
      public static void main(String[] args){
        var checker=new RocketCaptureReplay(); JSONArray[] frames={${snapshots.join(',')}};
        if(checker.containsRocketOrderDetails(frames[0]))throw new AssertionError("Home dashboard behind acceptance popup is not an order");
        for(int i=1;i<frames.length;i++){
          if(!checker.containsRocketOrderDetails(frames[i]))throw new AssertionError("Missing recorded menu frame "+i);
          if(!checker.extractRocketDetailOrderCode(frames[i]).equals("T3ST01"))throw new AssertionError("Wrong detail identity "+i);
        }
        var ambiguous=snapshot(new String[][]{{"0.1.1","T3ST01\\n[メニュー 1個] 100円"},{"0.1.2","T3ST02\\n[メニュー 1個] 200円"},{"0.2.1","メニュー"},{"0.2.2","数量"},{"0.2.3","金額"}});
        if(!checker.extractRocketDetailOrderCode(ambiguous).isEmpty())throw new AssertionError("Multiple cards without a detail identity must not mix orders");
        System.out.println("PASS: real confirmation/dashboard rejected, recorded detail frames identified, ambiguous history list rejected");
      }
    }`
};
try {
  const paths=[];
  for(const [path,body] of Object.entries(files)){const target=join(tmp,path);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,body);paths.push(target);}
  const binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(binary('javac'),['-d',tmp,...paths,resolve('Foundr1Android/app/src/bridge/java/jp/foundr1/store/bridge/RocketAcceptPolicy.java')],{stdio:'inherit',timeout:30000});
  execFileSync(binary('java'),['-cp',tmp,'jp.foundr1.store.bridge.RocketCaptureReplay'],{stdio:'inherit',timeout:15000});
} finally {rmSync(tmp,{recursive:true,force:true});}
