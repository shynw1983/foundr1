import assert from "node:assert/strict";
import test from "node:test";
import {runInNewContext} from 'node:vm';

import { DemaeCanAdapter, fillInput } from "../src/adapters/demae-can.mjs";

test('menu publication refreshes stale authentication and stops before writes when login fails',async()=>{
 const events=[];
 const page={reload:async()=>events.push('reload'),waitForNetworkIdle:async()=>events.push('idle'),waitForFunction:async predicate=>{
  const ready=(text,url='/merchant-admin/shop/stockout',password=false)=>runInNewContext(`(${predicate.toString()})()`,{document:{body:{innerText:text},querySelector:()=>password?{}:null},location:{href:url}});
  assert.equal(ready('メールアドレスとパスワードのみでログイン'),false);
  assert.equal(ready('品切れ終売設定'),true);
  assert.equal(ready('ログイン','/merchant-admin/login',true),true);
  assert.equal(ready('','/merchant-admin/login'),false);
  events.push('ready');
 }};
 const adapter=new DemaeCanAdapter({config:{storeId:'store'},goto:async()=>{events.push('goto');return page;}},{chainId:'1'});
 adapter.ensureAuthenticated=async()=>{events.push('auth');throw Error('demae_can_login_required');};
 const payload={authoritativePublication:true,platformKey:'demae_can',merchantId:'1',sourceId:'source',storeId:'store',revision:11,newItemsHidden:true,imagePolicy:'read_only',targets:[{kind:'option_group',sourceKey:'option_group:g',targetId:'g',mappings:[],marker:'FS0123456789abcd'}]};
 await assert.rejects(()=>adapter.publishMenuChanges(payload),/login_required/);
 assert.deepEqual(events,['goto','reload','idle','ready','auth']);
 delete adapter.config.chainId;events.length=0;
 await assert.rejects(()=>adapter.publishMenuChanges(payload),/login_required/);
 assert.deepEqual(events,['goto','reload','idle','ready','auth']);
 events.length=0;payload.storeId='foreign';
 await assert.rejects(()=>adapter.publishMenuChanges(payload),/store_scope_mismatch/);
 assert.deepEqual(events,[]);
});

test("fills Demae login inputs without ElementHandle click or type calls", async () => {
  let disposed = false;
  let evaluatedWith = null;
  const page = {
    async waitForSelector() {
      return {
        async dispose() { disposed = true; },
        async click() { throw new Error("click should not be called"); },
        async type() { throw new Error("type should not be called"); }
      };
    },
    async evaluate(_function, argument) {
      evaluatedWith = argument;
      return true;
    }
  };

  assert.equal(await fillInput(page, 'input[name="handleCd"]', "shop-code"), true);
  assert.equal(disposed, true);
  assert.deepEqual(evaluatedWith, {
    selectorValue: 'input[name="handleCd"]',
    inputValue: "shop-code"
  });
});

test("refreshes the Demae inventory page and retries matching when an expired page returns no rows", async () => {
  let reloadCount = 0;
  let inventoryReadCount = 0;
  const page = {
    async evaluate(_script, argument) {
      if (argument === undefined) {
        return {
          url: "https://partner.demae-can.com/merchant-admin/shop/stockout",
          title: "品切れ終売設定",
          text: "品切れ終売設定"
        };
      }
      inventoryReadCount += 1;
      if (inventoryReadCount === 1) return [{ label: "半熟卵", names: ["半熟卵"], matches: [] }];
      return [{
        label: "半熟卵",
        names: ["半熟卵"],
        matches: [{ rowId: "row-1", unavailable: false, permanentlyUnavailable: false }]
      }];
    },
    async waitForSelector() {
      return {};
    },
    async reload() {
      reloadCount += 1;
    },
    async waitForNetworkIdle() {}
  };
  const adapter = new DemaeCanAdapter({
    async goto() {
      return page;
    }
  });

  const result = await adapter.locateTargets([{ label: "半熟卵", aliases: [] }]);

  assert.equal(reloadCount, 1);
  assert.equal(inventoryReadCount, 2);
  assert.equal(result[0].matches.length, 1);
});
