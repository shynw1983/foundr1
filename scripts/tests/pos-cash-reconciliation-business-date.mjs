import assert from "node:assert/strict";
import { build, stop } from "esbuild";
import { resolve } from "node:path";

// Executes real GET/POST handlers with an in-memory database adapter.
// No database credentials or real authentication sessions are loaded.
const fixtureKey = "__posCashBusinessDateFixture";
const storeId = "069bce96-a233-4284-a301-2f32ad79a548";
const currentDate = "2026-10-19";
const previousDate = "2026-10-18";
const routePath = resolve(process.env.CASH_RECONCILIATION_ROUTE || "app/api/store/pos/reconciliation/route.ts");
const originalFetch = globalThis.fetch;
const stubSources = {
  "pos-operator-access": `export async function requirePosOperatorForWrite(session){return {ok:true,enabled:false,actor:session,operatorSessionId:null,approver:null,writeGuards:[]}}`,
  "pos-operator-credentials": `export const assertPosOperatorSameOrigin=()=>null;export const posOperatorDatabaseFailure=()=>null;`,
  "api-auth": `export const requireOsSession = async () => globalThis.${fixtureKey}.session;`,
  db: `
    export async function sql(strings, ...values) {
      const fixture = globalThis.${fixtureKey};
      const text = strings.join("?").replace(/\\s+/g, " ").trim();
      if (/^select pg_advisory_xact_lock/.test(text)) return [];
      if (text.includes('as cash_session_current')) {
        if (!fixture.activeSession || fixture.activeSession.id!==values[1] || fixture.activeSession.status!=='open') throw new Error('Session guard rejected stale fixture');
        return [{cash_session_current:1}];
      }
      if (text.includes('as financials_current')) {
        if (!fixture.activeSession || fixture.activeSession.id!==values[1] || fixture.activeSession.openingAmount!==values[0]) throw new Error('Financial guard rejected changed fixture');
        return [{financials_current:1}];
      }
      if (/^select id from pos_cash_sessions/.test(text)&&/for update$/.test(text)) return fixture.activeSession?[{id:fixture.activeSession.id}]:[];
      if (fixture.allowCloseWrite && /^update pos_cash_sessions set status = 'closed',/.test(text)) {
        if (!fixture.activeSession || fixture.activeSession.id !== values[6] || fixture.activeSession.status !== "open") throw new Error("Close update did not target the open fixture session");
        fixture.closeWrites.push({ text, values });
        fixture.activeSession = null;
        return [];
      }
      if (!/^(select|with)\\b/i.test(text) || /\\b(insert|update|delete|alter|drop|truncate)\\b/i.test(text)) {
        throw new Error("A write was attempted by the read-only reconciliation fixture: " + text);
      }
      fixture.queries.push({ text, values });
      if (text.includes("business_hours")) return [{ businessHours: {} }];
      if (text.includes("with latest_punch as")) {
        fixture.responsibleEmployeeQueries.push({ text, values });
        return [{ id: "00000000-0000-4000-8000-000000000001", name: "責任者", role: "manager", attendanceStatus: "manager" }];
      }
      if (text.includes('as "cashSales"')) return [{ cashSales: 0 }];
      if (text.includes('as "movementCount"')) return [{ cashIn: 0, cashOut: 0, movementCount: 0 }];
      if (text.includes("from pos_cash_sessions") && text.includes("pos_cash_sessions.status = 'open'")) {
        return fixture.activeSession ? [fixture.activeSession] : [];
      }
      if (/from (pos_cash_sessions|pos_cash_movements|pos_order_corrections|store_customer_orders)\\b/.test(text)) return [];
      throw new Error("Unexpected SQL in reconciliation fixture: " + text);
    }
    sql.transaction=async statements=>Promise.all(statements);
  `,
  loyalty: "export async function reverseLoyaltyForRefundedOrder() { throw new Error('Unexpected loyalty write'); }",
  "order-realtime": `export async function publishStoreOperationalEvent(...args) { globalThis.${fixtureKey}.events.push(args); }`,
  "sales-orders": "export async function syncWebReservationToSalesOrder() { throw new Error('Unexpected sales write'); }",
  "store-business-hours": `export const getStoreCashBusinessDayState = () => ({ businessDate: "${currentDate}", status: "before_open", detailLabel: "開店準備時間です。" });`,
  "store-order-access": `
    export async function getStoreOrderAccess() { return { stores: [{ id: "${storeId}", name: "桜並木店" }] }; }
    export function getScopedStoreFilter(_access, requestedStoreId) {
      return globalThis.${fixtureKey}.forbidden ? "__forbidden__" : requestedStoreId || "${storeId}";
    }
  `
};

try {
  const bundle = await build({
    entryPoints: [routePath],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "isolated-reconciliation-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /(?:^|\/)(api-auth|db|loyalty|order-realtime|sales-orders|store-business-hours|store-order-access|pos-operator-access|pos-operator-credentials)$/ }, (args) => ({
          path: args.path.split("/").at(-1), namespace: "cash-fixture"
        }));
        builder.onLoad({ filter: /.*/, namespace: "cash-fixture" }, ({ path }) => ({ contents: stubSources[path], loader: "js" }));
      }
    }]
  });
  globalThis.fetch = async () => { throw new Error("Network access is forbidden in the reconciliation fixture"); };
  const { GET, POST } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const session = { id: "00000000-0000-4000-8000-000000000002", name: "店舗端末", role: "store_terminal" };
  const activeSession = {
    id: "00000000-0000-4000-8000-000000000003",
    storeId,
    storeName: "桜並木店",
    businessDate: previousDate,
    status: "open",
    openingAmount: 0,
    openingCashBreakdown: {},
    expectedCashAmount: 0,
    countedCashAmount: null,
    countedCashBreakdown: {},
    differenceAmount: null
  };
  let passed = 0;
  for (const scenario of [
    { name: "unclosed previous-day session", activeSession, expectedDate: previousDate },
    { name: "unclosed session with another report date", activeSession, reportDate: "2026-10-17", expectedDate: previousDate },
    { name: "no active session uses current business day", activeSession: null, expectedDate: currentDate },
    { name: "no active session uses selected report date", activeSession: null, reportDate: "2026-10-17", expectedDate: "2026-10-17" }
  ]) {
    const fixture = { session, activeSession: scenario.activeSession, forbidden: false, queries: [], responsibleEmployeeQueries: [] };
    globalThis[fixtureKey] = fixture;
    const query = new URLSearchParams({ storeId, ...(scenario.reportDate ? { date: scenario.reportDate } : {}) });
    const response = await GET(new Request(`https://fixture.invalid/api/store/pos/reconciliation?${query}`));
    assert.equal(response.status, 200, scenario.name);
    const body = await response.json();
    assert.equal(body.businessDate, scenario.reportDate || currentDate, `${scenario.name}: report date is preserved`);
    assert.equal(body.activeSession?.businessDate ?? null, scenario.activeSession?.businessDate ?? null, scenario.name);
    assert.equal(fixture.responsibleEmployeeQueries.length, 1, `${scenario.name}: one candidate query`);
    const queriedDates = fixture.responsibleEmployeeQueries[0].values.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)));
    assert.equal(queriedDates.length, 3, `${scenario.name}: punch range and shift date are checked`);
    assert.deepEqual(queriedDates, Array(3).fill(scenario.expectedDate), `${scenario.name}: responsibility candidates match the session business day`);
    passed++;
  }
  for (const scenario of [
    { name: "unauthenticated", session: null, forbidden: false, expectedStatus: 401 },
    { name: "another store is forbidden", session, forbidden: true, expectedStatus: 403 }
  ]) {
    const fixture = { ...scenario, queries: [], responsibleEmployeeQueries: [] };
    globalThis[fixtureKey] = fixture;
    const response = await GET(new Request(`https://fixture.invalid/api/store/pos/reconciliation?storeId=${storeId}`));
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.equal(fixture.queries.length, 0, `${scenario.name}: denied before database access`);
    passed++;
  }
  for (const scenario of [
    { name: "confirmed zero balance closes at zero", expectedCash: 0, note: "", expectedStatus: 200 },
    { name: "zero count with shortage requires a reason", expectedCash: 100, note: "", expectedStatus: 400, error: "差額があるため理由を入力してください。" },
    { name: "zero count with shortage and reason closes", expectedCash: 100, note: "現金を回収済み", expectedStatus: 200 },
    { name: "noncandidate responsible employee is rejected", expectedCash: 0, note: "", responsibleEmployeeId: "00000000-0000-4000-8000-000000000099", expectedStatus: 400, error: "出勤中・本日シフト・責任者の候補から締め責任者を選択してください。" },
    { name: "malformed responsible employee is rejected", expectedCash: 0, note: "", responsibleEmployeeId: "invalid", expectedStatus: 400, error: "締め責任者を選択してください。" },
    { name: "unauthenticated POST does not write", session: null, expectedCash: 0, expectedStatus: 401 },
    { name: "forbidden-store POST does not write", forbidden: true, expectedCash: 0, expectedStatus: 403 }
  ]) {
    const responsibleEmployeeId = scenario.responsibleEmployeeId || "00000000-0000-4000-8000-000000000001";
    const fixture = {
      session: Object.hasOwn(scenario, "session") ? scenario.session : session,
      forbidden: scenario.forbidden || false,
      activeSession: { ...structuredClone(activeSession), openingAmount: scenario.expectedCash, expectedCashAmount: scenario.expectedCash },
      queries: [], responsibleEmployeeQueries: [], closeWrites: [], events: [], allowCloseWrite: true
    };
    globalThis[fixtureKey] = fixture;
    const response = await POST(new Request("https://fixture.invalid/api/store/pos/reconciliation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close", storeId, countedBreakdown: { "1000": "", "100": "" }, note: scenario.note || "", closingResponsibleEmployeeId: responsibleEmployeeId })
    }));
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    const body = await response.json();
    if (scenario.expectedStatus === 200) {
      assert.equal(body.ok, true, scenario.name);
      assert.equal(body.activeSession, null, `${scenario.name}: no open session after close`);
      assert.equal(fixture.closeWrites.length, 1, `${scenario.name}: exactly one in-memory close update`);
      const { text, values } = fixture.closeWrites[0];
      assert.match(text, /expected_cash_amount = \?, counted_cash_amount = \?, counted_cash_breakdown = \?, difference_amount = \?, closing_note = \?, closed_by = \?/);
      assert.equal(values[0], scenario.expectedCash, `${scenario.name}: expected cash persisted`);
      assert.equal(values[1], 0, `${scenario.name}: actual counted zero persisted`);
      const savedBreakdown = JSON.parse(values[2]);
      assert.equal(Object.keys(savedBreakdown).length, 10, `${scenario.name}: all denominations persisted`);
      assert.ok(Object.values(savedBreakdown).every((count) => count === 0), `${scenario.name}: every denomination is zero`);
      assert.equal(values[3], -scenario.expectedCash || 0, `${scenario.name}: exact difference persisted`);
      assert.equal(values[4], scenario.note, `${scenario.name}: reason persisted`);
      assert.equal(values[5], responsibleEmployeeId, `${scenario.name}: responsible employee persisted`);
      assert.equal(values[6], activeSession.id, `${scenario.name}: correct session updated`);
      assert.deepEqual(fixture.events, [[storeId, "pos.reconciliation.updated"]], `${scenario.name}: one stubbed realtime notification`);
      const validationQueryDates = fixture.responsibleEmployeeQueries[0].values.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)));
      assert.deepEqual(validationQueryDates, Array(3).fill(previousDate), `${scenario.name}: previous-day session responsibility validated`);
    } else {
      assert.equal(fixture.closeWrites.length, 0, `${scenario.name}: no close write`);
      assert.equal(fixture.events.length, 0, `${scenario.name}: no publication on failure`);
      assert.equal(fixture.activeSession?.status, "open", `${scenario.name}: original session remains open`);
      if (scenario.error) assert.equal(body.error, scenario.error, scenario.name);
      if (scenario.expectedStatus === 401 || scenario.expectedStatus === 403) assert.equal(fixture.queries.length, 0, `${scenario.name}: denied before database access`);
    }
    passed++;
  }
  console.log(`PASS: ${passed} reconciliation GET/POST scenarios; SQL is stubbed, only close writes are allowed in memory, and network access is forbidden.`);
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis[fixtureKey];
  stop();
}
