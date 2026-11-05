import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

// Isolated PostgreSQL only: this suite never imports lib/db or DATABASE_URL.
const pglitePath = process.env.FOUNDR1_PGLITE_MODULE || "../outputs/inventory-reference-implementation-20261014/test-deps/node_modules/@electric-sql/pglite/dist/index.js";
const { PGlite } = await import(pglitePath);
const notificationCode = ts.transpileModule(readFileSync(new URL("./inventory-sync-notifications.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const attentionCode = ts.transpileModule(readFileSync(new URL("./inventory-sync-attention.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const businessDayCode = ts.transpileModule(readFileSync(new URL("./inventory-sync-business-day.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const migration = readFileSync(new URL("../db/migrations/20261018_inventory_sync_alert_deliveries.sql", import.meta.url), "utf8");
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table stores (id uuid primary key, name text, external_id text, status text default 'active', business_hours jsonb default '{}');
    create table employees (id uuid primary key, role text, status text default 'active', session_version integer default 1);
    create table employee_sessions (id uuid primary key, employee_id uuid references employees(id), session_version integer default 1,
      revoked_at timestamptz, expires_at timestamptz default now()+interval '14 days', surface text default 'store', created_at timestamptz default now());
    create table employee_scopes (employee_id uuid, scope_type text, store_id uuid);
    create table local_bridge_commands (id uuid primary key, store_id uuid references stores(id), platform text default 'rocket_now',
      command_type text default 'set_inventory_availability', status text default 'failed', payload jsonb, result jsonb default '{}',
      last_error text default 'timeout', attempts int default 3, created_at timestamptz default now()-interval '10 minutes', updated_at timestamptz default now());
    create table os_notifications (id uuid primary key default gen_random_uuid(), recipient_employee_id uuid references employees(id),
      notification_type text, title text, message text, href text, source_key text not null, read_at timestamptz);
    create unique index notification_key on os_notifications(recipient_employee_id, source_key) where source_key <> '';
    create table web_push_subscriptions (id uuid primary key, employee_id uuid references employees(id), endpoint text, p256dh text default 'key', auth text default 'auth',
      revoked_at timestamptz, last_success_at timestamptz, last_error text, updated_at timestamptz default now());
    create table store_order_push_devices (id uuid primary key, employee_id uuid references employees(id), session_id uuid references employee_sessions(id),
      provider text default 'fcm', registration jsonb default '{"token":"not-real","inventorySyncVersion":1}', language text default 'ja', revoked_at timestamptz, last_success_at timestamptz, last_error text default '');
  `);
  await db.exec(migration);
  await db.query("insert into stores(id,name,external_id) values ($1,'Test store','merchant-store-a-not-json'),($2,'Other store','merchant-store-b-not-json')", [id(1), id(2)]);
  const commands = async () => (await db.query("select id::text from local_bridge_commands order by created_at desc")).rows;
  const events: string[] = [], web: Array<{ subscription: any; payload: any; options: any }> = [], native: Array<{ device: any; payload: any; options: any }> = [];
  let webFailure = 0, nativeFailure = false, nativeExpired = false, scanError = false;
  let clockOffset = 0, claimCostMs = 0;
  let sendHook: ((channel: "web_push" | "fcm") => Promise<void> | void) | undefined;
  class Clock extends Date { static now() { return Date.now() + clockOffset; } }
  class TestTransportError extends Error {
    expired: boolean;
    constructor(message: string, expired = false) { super(message); this.expired = expired; }
  }
  let beforeClaim: (() => Promise<void>) | undefined;
  let beforeCreate: (() => Promise<void>) | undefined;
  const queries: string[] = [];
  const execute = async (query: string, values: unknown[]) => {
    queries.push(query);
    if (query.includes("insert into menu_inventory_sync_alert_deliveries")) clockOffset += claimCostMs;
    if (query.includes("insert into os_notifications") && beforeCreate) {
      const hook = beforeCreate; beforeCreate = undefined; await hook();
    }
    if (query.includes("insert into menu_inventory_sync_alert_deliveries") && beforeClaim) {
      const hook = beforeClaim; beforeClaim = undefined; await hook();
    }
    return (await db.query(query, values)).rows;
  };
  const sql = Object.assign(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ""), "");
    return execute(query, values);
  }, { query: execute });
  const businessDay: any = {};
  runInNewContext(businessDayCode, { exports: businessDay });
  const attention: any = {};
  runInNewContext(attentionCode, { exports: attention, require: (name: string) => {
    if (name === "./inventory-sync-business-day" || name === "./inventory-sync-business-day.ts") return businessDay;
    assert.equal(name, "./db"); return { sql };
  } });
  const exports: any = {};
  const env = { WEB_PUSH_VAPID_PUBLIC_KEY: "public", WEB_PUSH_VAPID_PRIVATE_KEY: "private" };
  runInNewContext(notificationCode, {
    exports, process: { env }, Date: Clock, Promise, setTimeout, clearTimeout, encodeURIComponent,
    require: (name: string) => {
      if (name === "node:crypto") return crypto;
      if (name === "./db") return { sql };
      if (name === "./inventory-sync-attention") return { inventorySyncCommandRecheckSql: attention.inventorySyncCommandRecheckSql, getInventorySyncAttentionCommands: async (storeId: string) => {
        if (scanError) throw new Error("sensitive SQL error");
        return attention.getInventorySyncAttentionCommands(storeId);
      } };
      if (name === "./notification-realtime") return { publishOsNotificationEvent: async (employeeId: string) => { events.push(employeeId); } };
      if (name === "web-push") return { default: {
        setVapidDetails: () => {},
        sendNotification: async (subscription: any, payload: string, options: any) => {
          web.push({ subscription, payload: JSON.parse(payload), options });
          await sendHook?.("web_push");
          if (webFailure) throw Object.assign(new Error("sensitive endpoint/provider error"), { statusCode: webFailure });
        }
      } };
      if (name === "./store-order-push-transport") return {
        getOrderPushConfig: () => ({ enabled: true, fcm: true }),
        OrderPushTransportError: TestTransportError,
        sendOrderPush: async (device: any, payload: any, options: any) => {
          native.push({ device, payload, options });
          await sendHook?.("fcm");
          if (nativeExpired) throw new TestTransportError("FCM_SEND_404", true);
          if (nativeFailure) throw new Error("sensitive registration token");
        }
      };
      throw new Error(`Unexpected dependency ${name}`);
    }
  });
  async function employee(number: number, role = "store_terminal", scope = id(1), language = "ja") {
    const employeeId = id(number), sessionId = id(number + 1000);
    await db.query("insert into employees(id,role) values ($1,$2)", [employeeId, role]);
    await db.query("insert into employee_sessions(id,employee_id) values ($1,$2)", [sessionId, employeeId]);
    if (scope) await db.query("insert into employee_scopes values ($1,'store',$2)", [employeeId, scope]);
    await db.query("insert into web_push_subscriptions(id,employee_id,endpoint) values ($1,$2,$3)", [employeeId, employeeId, `https://push.test/${number}`]);
    await db.query("insert into store_order_push_devices(id,employee_id,session_id,language) values ($1,$2,$3,$4)", [employeeId, employeeId, sessionId, language]);
    return { employeeId, sessionId };
  }
  async function command(number = 10, available = false, status = "failed", targets = [{ kind: "item", targetId: id(500), label: "Beef", knownExternalIds: ["native-beef"] }]) {
    const payload = { syncRunId: id(number + 5000), isAvailable: available, targets };
    await db.query("insert into local_bridge_commands(id,store_id,status,payload) values ($1,$2,$3,$4)", [id(number), id(1), status, payload]);
    return id(number);
  }
  return { db, exports, events, web, native, queries, commands, employee, command,
    notify: (storeId?: string) => exports.notifyInventorySyncAttention(storeId),
    setWebFailure: (code: number) => { webFailure = code; },
    setNativeFailure: (value: boolean) => { nativeFailure = value; },
    setNativeExpired: (value: boolean) => { nativeExpired = value; },
    setScanError: () => { scanError = true; },
    beforeClaim: (hook: () => Promise<void>) => { beforeClaim = hook; },
    beforeCreate: (hook: () => Promise<void>) => { beforeCreate = hook; },
    onSend: (hook: (channel: "web_push" | "fcm") => Promise<void> | void) => { sendHook = hook; },
    advance: (milliseconds: number) => { clockOffset += milliseconds; },
    setClaimCost: (milliseconds: number) => { claimCostMs = milliseconds; },
    close: () => db.close()
  };
}

test("failure delivery is scoped to full Store roles and valid sessions, including terminals inside the store", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.db.query("select pg_typeof(external_id)::text as type from stores limit 1")).rows[0].type, "text");
    await f.command();
    await f.employee(20, "owner", "");
    await f.employee(21, "manager", "", "zh-Hans");
    await f.employee(22, "store_terminal", id(1), "zh-Hant");
    await f.employee(23, "store_terminal", id(2));
    await f.employee(24, "staff");
    await f.employee(25, "store_manager");
    const expired = await f.employee(26);
    await f.db.query("update employee_sessions set expires_at=now()-interval '1 day', created_at=now()-interval '401 days' where id=$1", [expired.sessionId]);
    const revoked = await f.employee(27);
    await f.db.query("update employee_sessions set revoked_at=now() where id=$1", [revoked.sessionId]);
    const changed = await f.employee(28);
    await f.db.query("update employees set session_version=2 where id=$1", [changed.employeeId]);
    const result = await f.notify(id(1));
    assert.equal(result.created, 3); assert.equal(result.delivered, 6); assert.equal(result.failed, 0);
    assert.deepEqual(f.native.map(call => call.device.employeeId).sort(), [id(20), id(21), id(22)]);
    assert.ok(f.native.every(call => call.payload.type === "store_inventory_sync" && call.payload.priority === "high"));
    assert.ok(f.native.every(call => call.payload.href.includes("syncAttention=1") && !call.payload.ruleKey));
    assert.match(f.native.find(call => call.device.employeeId === id(21))!.payload.body, /已请求下架/);
    assert.match(f.native.find(call => call.device.employeeId === id(22))!.payload.body, /已請求下架/);
    assert.ok(f.web.every(call => call.options.timeout === 8000 && call.options.TTL === 300 && call.payload.deliveryKey === `inventory-sync:${id(10)}`));
    assert.ok(!f.queries.some(query => query.includes("store_order_push_presence") || query.includes("store_order_push_preferences")));
    assert.equal((await f.db.query("select count(*)::int n from os_notifications")).rows[0].n, 3);
  } finally { await f.close(); }
});

test("concurrent cron and ACK scans claim each destination once and successful sends stay deduplicated", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20);
    await Promise.all([f.notify(id(1)), f.notify(id(1)), f.notify(id(1))]);
    assert.equal(f.events.length, 1); assert.equal(f.web.length, 1); assert.equal(f.native.length, 1);
    await f.notify(id(1));
    assert.equal(f.web.length, 1); assert.equal(f.native.length, 1);
    const rows = (await f.db.query("select status,attempt_count from menu_inventory_sync_alert_deliveries")).rows;
    assert.equal(rows.length, 2); assert.ok(rows.every((row: { status: string; attempt_count: number }) => row.status === "sent" && row.attempt_count === 1));
  } finally { await f.close(); }
});

test("old failed operations stay in history without new notices or sends even when updated or manually retried today", async () => {
  const f = await fixture();
  try {
    await f.employee(20);
    for (const [number, daysOld] of [[10, 3], [11, 30]]) {
      await f.command(number, false, "failed", [{ kind: "item", targetId: id(500 + number), label: `Old product ${number}`, knownExternalIds: [`native-${number}`] }]);
      await f.db.query(`update local_bridge_commands set created_at=now()-$2::int*interval '1 day',updated_at=now(),
        payload=payload||jsonb_build_object('manualRetryAt',now()) where id=$1`, [id(number), daysOld]);
    }
    const historical = await f.notify(id(1));
    assert.equal(historical.scanned, 0); assert.equal(historical.created, 0); assert.equal(historical.delivered, 0);
    assert.equal(f.events.length, 0); assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
    assert.equal((await f.db.query("select count(*)::int n from os_notifications")).rows[0].n, 0);
    assert.equal((await f.db.query("select count(*)::int n from menu_inventory_sync_alert_deliveries")).rows[0].n, 0);

    await f.command(12, false, "failed", [{ kind: "item", targetId: id(512), label: "Current product", knownExternalIds: ["native-current"] }]);
    const current = await f.notify(id(1));
    assert.equal(current.scanned, 1); assert.equal(current.created, 1); assert.equal(current.delivered, 2);
    assert.deepEqual(f.native.map(call => call.payload.eventId), [id(12)]);
    assert.deepEqual(f.web.map(call => call.payload.deliveryKey), [`inventory-sync:${id(12)}`]);
    assert.equal((await f.db.query("select count(*)::int n from local_bridge_commands where status='failed'")).rows[0].n, 3,
      "excluding old operations from alerts preserves command history");
  } finally { await f.close(); }
});

test("in-app creation rechecks business-day scope when an old operation leaves the initial projection", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20);
    f.beforeCreate(async () => {
      await f.db.exec("update local_bridge_commands set created_at=now()-interval '3 days',updated_at=now(),payload=payload||jsonb_build_object('manualRetryAt',now())");
    });
    const result = await f.notify(id(1));
    assert.equal(result.scanned, 1); assert.equal(result.created, 0); assert.equal(result.delivered, 0);
    assert.equal(f.events.length, 0); assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
    assert.equal((await f.db.query("select count(*)::int n from os_notifications")).rows[0].n, 0);
    assert.equal((await f.db.query("select count(*)::int n from menu_inventory_sync_alert_deliveries")).rows[0].n, 0);
  } finally { await f.close(); }
});

test("delivery claims recheck business-day scope and cached notices cannot revive old operations for rotated tokens", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20);
    f.beforeClaim(async () => {
      await f.db.exec("update local_bridge_commands set created_at=now()-interval '3 days',updated_at=now(),payload=payload||jsonb_build_object('manualRetryAt',now())");
    });
    const first = await f.notify(id(1));
    assert.equal(first.created, 1); assert.equal(first.delivered, 0);
    assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
    assert.equal((await f.db.query("select count(*)::int n from menu_inventory_sync_alert_deliveries")).rows[0].n, 0);
    await f.db.exec("update store_order_push_devices set registration=registration||'{\"token\":\"fresh-token\"}'::jsonb");
    const repeated = await f.notify(id(1));
    assert.equal(repeated.scanned, 0); assert.equal(repeated.created, 0); assert.equal(repeated.delivered, 0);
    assert.equal(f.events.length, 1); assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
  } finally { await f.close(); }
});

test("transport failures preserve the in-app warning and retry after backoff without repeating successful destinations", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20); f.setNativeFailure(true);
    const failed = await f.notify(id(1));
    assert.equal(failed.created, 1); assert.equal(failed.delivered, 1); assert.equal(failed.failed, 1);
    await f.notify(id(1)); assert.equal(f.native.length, 1);
    await f.db.exec("update menu_inventory_sync_alert_deliveries set next_attempt_at=now()-interval '1 second' where status='failed'");
    f.setNativeFailure(false); await f.notify(id(1));
    assert.equal(f.web.length, 1); assert.equal(f.native.length, 2);
    const rows = (await f.db.query("select status,attempt_count,last_error from menu_inventory_sync_alert_deliveries order by channel")).rows;
    assert.ok(rows.every((row: { status: string; last_error: string }) => row.status === "sent" && !row.last_error));
    assert.equal(rows[0].attempt_count, 2);
    assert.equal((await f.db.query("select count(*)::int n from os_notifications")).rows[0].n, 1);
    assert.ok(!JSON.stringify(rows).includes("sensitive"));
  } finally { await f.close(); }
});

test("expired sending leases recover and an old completion cannot overwrite the new lease", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20); await f.notify(id(1));
    await f.db.exec("update menu_inventory_sync_alert_deliveries set status='sending',lease_until=now()-interval '1 second' where channel='fcm'");
    await f.notify(id(1));
    assert.equal(f.native.length, 2);
    const row = (await f.db.query("select status,attempt_count from menu_inventory_sync_alert_deliveries where channel='fcm'")).rows[0];
    assert.equal(row.status, "sent"); assert.equal(row.attempt_count, 2);
    assert.ok(f.queries.filter(query => query.includes("update menu_inventory_sync_alert_deliveries")).every(query => query.includes("lease_token =") && query.includes("status = 'sending'")));
  } finally { await f.close(); }
});

test("expired Web Push endpoints are revoked and ordinary failures remain retryable", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20); f.setWebFailure(410);
    const first = await f.notify(id(1)); assert.equal(first.failed, 1);
    assert.ok((await f.db.query("select revoked_at from web_push_subscriptions")).rows[0].revoked_at);
    await f.db.exec("update menu_inventory_sync_alert_deliveries set next_attempt_at=now()-interval '1 second'");
    await f.notify(id(1)); assert.equal(f.web.length, 1);
  } finally { await f.close(); }
});

test("resolved, replaced and revoked destinations are rechecked before external dispatch", async () => {
  const f = await fixture();
  try {
    await f.command(); const account = await f.employee(20);
    f.beforeClaim(async () => { await f.db.query("update employee_sessions set revoked_at=now() where id=$1", [account.sessionId]); });
    await f.notify(id(1)); assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
    await f.db.query("update employee_sessions set revoked_at=null where id=$1", [account.sessionId]);
    await f.command(11, true, "succeeded");
    await f.db.query("update local_bridge_commands set created_at=now() where id=$1", [id(11)]);
    assert.equal((await f.notify(id(1))).scanned, 0);
    assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
  } finally { await f.close(); }
});

test("stalled pending commands warn after five minutes; recent pending and healthy commands do not notify", async () => {
  const f = await fixture();
  try {
    await f.employee(20);
    await f.command(10, true, "pending");
    const first = await f.notify(id(1)); assert.equal(first.created, 1);
    assert.equal(f.native[0].payload.priority, "normal");
    assert.match(f.native[0].payload.body, /5分以上/);
    await f.db.query("update local_bridge_commands set created_at=now() where id=$1", [id(10)]);
    assert.equal((await f.notify(id(1))).scanned, 0);
    await f.db.query("update local_bridge_commands set status='succeeded' where id=$1", [id(10)]);
    assert.equal((await f.notify(id(1))).scanned, 0);
  } finally { await f.close(); }
});

test("missing migration and scan errors return diagnostics without rejecting the caller", async () => {
  const f = await fixture();
  try {
    f.setScanError(); assert.equal((await f.notify()).failed, 1);
    await f.db.exec("drop table menu_inventory_sync_alert_deliveries");
    assert.equal((await f.notify()).migrationRequired, true);
    assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
  } finally { await f.close(); }
});

test("a newer intent arriving after the scan atomically prevents the old failed command from sending", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20);
    f.beforeClaim(async () => { await f.command(11, true, "succeeded"); });
    await f.notify(id(1));
    assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
    assert.equal((await f.db.query("select count(*)::int n from menu_inventory_sync_alert_deliveries")).rows[0].n, 0);
  } finally { await f.close(); }
});

test("an old APK is not marked delivered, so upgrade of the same registration can receive the outstanding warning", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20);
    await f.db.exec("update store_order_push_devices set registration=registration-'inventorySyncVersion'");
    await f.notify(id(1));
    assert.equal(f.web.length, 1); assert.equal(f.native.length, 0);
    assert.equal((await f.db.query("select count(*)::int n from menu_inventory_sync_alert_deliveries where channel='fcm'")).rows[0].n, 0);
    await f.db.exec("update store_order_push_devices set registration=registration||'{\"inventorySyncVersion\":1}'::jsonb");
    await f.notify(id(1)); assert.equal(f.web.length, 1); assert.equal(f.native.length, 1);
  } finally { await f.close(); }
});

test("dispatch respects its total budget and later commands get the next invocation before accepted rows", async () => {
  const f = await fixture();
  try {
    await f.employee(20);
    await f.command();
    await f.command(11, false, "failed", [{ kind: "item", targetId: id(501), label: "Tofu", knownExternalIds: ["native-tofu"] }]);
    await f.db.query("update local_bridge_commands set created_at=now()-interval '9 minutes' where id=$1", [id(11)]);
    f.onSend(() => f.advance(26_000));
    await f.notify(id(1));
    assert.equal(f.native.length + f.web.length, 2);
    assert.equal(f.native[0].payload.eventId, id(11));
    f.onSend(() => {});
    await f.notify(id(1));
    assert.equal(f.native.length, 2); assert.equal(f.web.length, 2);
    assert.equal(f.native[1].payload.eventId, id(10));
  } finally { await f.close(); }
});

test("in-app progress reaches unseen commands without eligible devices and cached notices leave budget for new devices", async () => {
  const f = await fixture();
  try {
    await f.employee(20);
    await f.db.exec("delete from web_push_subscriptions; update store_order_push_devices set registration=registration-'inventorySyncVersion'");
    for (const number of [10, 11, 12]) {
      await f.command(number, false, "failed", [{ kind: "item", targetId: id(500 + number), label: `Product ${number}`, knownExternalIds: [`native-${number}`] }]);
      await f.db.query("update local_bridge_commands set created_at=now()-$2::int*interval '1 minute' where id=$1", [id(number), 40 - number]);
    }
    const notified = async () => (await f.db.query("select source_key from os_notifications order by source_key")).rows.map((row: { source_key: string }) => row.source_key);
    for (const number of [12, 11, 10]) {
      f.beforeCreate(async () => { f.advance(26_000); });
      assert.equal((await f.notify(id(1))).created, 1);
      assert.ok((await notified()).includes(`inventory-sync:${id(number)}`));
    }
    assert.equal((await notified()).length, 3);
    assert.equal((await f.db.query("select count(*)::int n from menu_inventory_sync_alert_deliveries")).rows[0].n, 0);
    assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
    const inserts = f.queries.filter(query => query.includes("insert into os_notifications")).length;
    let repeatedCreate = false;
    f.beforeCreate(async () => { repeatedCreate = true; f.advance(26_000); });
    assert.equal((await f.notify(id(1))).created, 0);
    assert.equal(repeatedCreate, false);
    assert.equal(f.queries.filter(query => query.includes("insert into os_notifications")).length, inserts);
    await f.db.exec("update store_order_push_devices set registration=registration||'{\"inventorySyncVersion\":1}'::jsonb");
    assert.equal((await f.notify(id(1))).delivered, 3);
    assert.deepEqual(f.native.map(call => call.payload.eventId).sort(), [id(10), id(11), id(12)]);
    assert.equal(repeatedCreate, false);
  } finally { await f.close(); }
});

test("accepted destinations skip repeat claims while rotated native tokens receive every outstanding warning within budget", async () => {
  const f = await fixture();
  try {
    await f.employee(20);
    for (const number of [10, 11, 12]) {
      await f.command(number, false, "failed", [{ kind: "item", targetId: id(500 + number), label: `Product ${number}`, knownExternalIds: [`native-${number}`] }]);
    }
    assert.equal((await f.notify(id(1))).delivered, 6);
    const claims = () => f.queries.filter(query => query.includes("insert into menu_inventory_sync_alert_deliveries")).length;
    const acceptedClaims = claims();
    f.setClaimCost(8_000);
    const repeated = await f.notify(id(1));
    assert.equal(repeated.delivered, 0); assert.equal(repeated.failed, 0);
    assert.equal(claims(), acceptedClaims, "accepted destinations consume no claim budget or synthetic deliveries");
    await f.db.exec("update store_order_push_devices set registration=registration||'{\"token\":\"rotated-token\"}'::jsonb");
    const rotated = await f.notify(id(1));
    assert.equal(rotated.delivered, 3); assert.equal(rotated.failed, 0);
    assert.equal(claims(), acceptedClaims + 3, "three fresh native claims fit the 25-second budget at eight seconds each");
    assert.equal(f.web.length, 3, "accepted web endpoints are not reclaimed or resent");
    assert.deepEqual(f.native.slice(3).map(call => call.payload.eventId).sort(), [id(10), id(11), id(12)]);
    assert.ok(f.native.slice(3).every(call => call.device.registration.token === "rotated-token"));
    assert.equal((await f.notify(id(1))).delivered, 0);
    assert.equal(claims(), acceptedClaims + 3);
    assert.ok((await f.db.query("select attempt_count from menu_inventory_sync_alert_deliveries")).rows.every((row: { attempt_count: number }) => row.attempt_count === 1));
  } finally { await f.close(); }
});

test("cached in-app notices still atomically recheck changed copy and unknown recipients", async () => {
  const f = await fixture();
  try {
    await f.command(); const original = await f.employee(20);
    await f.notify(id(1));
    const inserts = () => f.queries.filter(query => query.includes("insert into os_notifications")).length;
    const firstInserts = inserts();
    await f.notify(id(1)); assert.equal(inserts(), firstInserts);
    await f.db.exec("update stores set name='Renamed store'");
    f.beforeCreate(async () => { await f.db.query("delete from employee_scopes where employee_id=$1", [original.employeeId]); });
    await f.notify(id(1));
    assert.equal(inserts(), firstInserts + 1);
    const oldNotice = (await f.db.query("select message from os_notifications where recipient_employee_id=$1", [original.employeeId])).rows[0];
    assert.doesNotMatch(oldNotice.message, /Renamed store/);
    const added = await f.employee(21);
    assert.equal((await f.notify(id(1))).created, 1);
    assert.equal(inserts(), firstInserts + 2);
    assert.match((await f.db.query("select message from os_notifications where recipient_employee_id=$1", [added.employeeId])).rows[0].message, /Renamed store/);
  } finally { await f.close(); }
});

test("in-app insertion rechecks current exact targets and omits an intent replaced after the initial scan", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20);
    f.beforeCreate(async () => { await f.command(11, true, "succeeded"); });
    const result = await f.notify(id(1));
    assert.equal(result.created, 0); assert.equal(f.events.length, 0);
    assert.equal((await f.db.query("select count(*)::int n from os_notifications")).rows[0].n, 0);
    assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
  } finally { await f.close(); }
});

test("partial replacement before in-app insertion waits for a fresh projection and only names remaining targets", async () => {
  const f = await fixture();
  try {
    await f.employee(20);
    const beef = { kind: "item", targetId: id(500), label: "Beef", knownExternalIds: ["beef"] };
    const tofu = { kind: "item", targetId: id(501), label: "Tofu", knownExternalIds: ["tofu"] };
    await f.command(10, false, "failed", [beef, tofu]);
    f.beforeCreate(async () => { await f.command(11, true, "succeeded", [beef]); });
    assert.equal((await f.notify(id(1))).created, 0);
    assert.equal((await f.notify(id(1))).created, 1);
    const rows = (await f.db.query("select message from os_notifications")).rows;
    assert.match(rows[0].message, /Tofu/); assert.doesNotMatch(rows[0].message, /Beef/);
    assert.ok(f.native.every(call => call.payload.body.includes("Tofu") && !call.payload.body.includes("Beef")));
  } finally { await f.close(); }
});

test("in-app insertion rechecks session and store scope instead of using cached recipients", async () => {
  const f = await fixture();
  try {
    await f.command(); const account = await f.employee(20);
    f.beforeCreate(async () => { await f.db.query("delete from employee_scopes where employee_id=$1", [account.employeeId]); });
    const result = await f.notify(id(1));
    assert.equal(result.created, 0);
    assert.equal((await f.db.query("select count(*)::int n from os_notifications")).rows[0].n, 0);
    assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
  } finally { await f.close(); }
});

test("token and endpoint rotation between discovery and claim cannot send or mark the replaced destinations", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20);
    f.beforeClaim(async () => {
      await f.db.exec("update store_order_push_devices set registration=registration||'{\"token\":\"fresh-token\"}'::jsonb");
      await f.db.exec("update web_push_subscriptions set endpoint='https://push.test/fresh'");
    });
    await f.notify(id(1));
    assert.equal(f.web.length, 0); assert.equal(f.native.length, 0);
    await f.notify(id(1));
    assert.equal(f.web[0].subscription.endpoint, "https://push.test/fresh");
    assert.equal(f.native[0].device.registration.token, "fresh-token");
  } finally { await f.close(); }
});

test("a stale native UNREGISTERED response never revokes a newly rotated token", async () => {
  const f = await fixture();
  try {
    await f.command(); await f.employee(20); f.setNativeExpired(true);
    f.onSend(async channel => {
      if (channel === "fcm") await f.db.exec("update store_order_push_devices set registration=registration||'{\"token\":\"fresh-token\"}'::jsonb,last_error='fresh-binding'");
    });
    await f.notify(id(1));
    const row = (await f.db.query("select revoked_at,last_error,registration from store_order_push_devices")).rows[0];
    assert.equal(row.revoked_at, null); assert.equal(row.last_error, "fresh-binding");
    assert.equal(row.registration.token, "fresh-token");
    f.setNativeExpired(false); f.onSend(() => {}); await f.notify(id(1));
    assert.equal(f.native.length, 2); assert.equal(f.native[1].device.registration.token, "fresh-token");
  } finally { await f.close(); }
});

test("stale successful native acceptance cannot overwrite a new session or token's transport health", async () => {
  const f = await fixture();
  try {
    await f.command(); const account = await f.employee(20);
    const nextSession = id(9000);
    await f.db.query("insert into employee_sessions(id,employee_id) values($1,$2)", [nextSession, account.employeeId]);
    f.onSend(async channel => {
      if (channel === "fcm") await f.db.query("update store_order_push_devices set registration=registration||'{\"token\":\"new-session-token\"}'::jsonb,session_id=$1,last_error='fresh-binding'", [nextSession]);
    });
    await f.notify(id(1));
    const row = (await f.db.query("select last_success_at,last_error,session_id::text from store_order_push_devices")).rows[0];
    assert.equal(row.last_success_at, null); assert.equal(row.last_error, "fresh-binding"); assert.equal(row.session_id, nextSession);
  } finally { await f.close(); }
});

test("stale Web Push expiration and acceptance do not overwrite a rotated endpoint", async () => {
  for (const failure of [0, 410]) {
    const f = await fixture();
    try {
      await f.command(); await f.employee(20); f.setWebFailure(failure);
      f.onSend(async channel => {
        if (channel === "web_push") await f.db.exec("update web_push_subscriptions set endpoint='https://push.test/fresh',last_error='fresh-binding'");
      });
      await f.notify(id(1));
      const row = (await f.db.query("select revoked_at,last_success_at,last_error,endpoint from web_push_subscriptions")).rows[0];
      assert.equal(row.revoked_at, null); assert.equal(row.last_success_at, null);
      assert.equal(row.last_error, "fresh-binding"); assert.equal(row.endpoint, "https://push.test/fresh");
    } finally { await f.close(); }
  }
});
