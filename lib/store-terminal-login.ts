import { createHash, randomBytes } from "node:crypto";
import { authCookieName, createSessionToken, type EmployeeSession } from "./auth";
import { getSessionStoreScope } from "./api-auth";
import { sql } from "./db";
import { createEmployeeSession, sessionCookieMaxAge } from "./employee-sessions";
import { getNavPathsForPermissions, getPermissionsForRole } from "./role-permissions";

const terminalLoginTokenBytes = 32;
const terminalLoginExpiresIntervalSql = "5 minutes";
const terminalLoginApproverRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);

export type TerminalLoginStoreOption = {
  id: string;
  name: string;
  terminalAccounts: Array<{ id: string; name: string; loginId: string }>;
};

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

export function createTerminalLoginToken() {
  return randomBytes(terminalLoginTokenBytes).toString("base64url");
}

export function hashTerminalLoginToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function canApproveTerminalLogin(session: EmployeeSession) {
  return terminalLoginApproverRoles.has(session.role);
}

export async function createTerminalLoginRequest(request: Request) {
  const token = createTerminalLoginToken();
  const rows = await sql`
    insert into store_terminal_login_requests (
      token_hash,
      requested_user_agent,
      requested_ip_address,
      expires_at
    )
    values (
      ${hashTerminalLoginToken(token)},
      ${request.headers.get("user-agent") || ""},
      ${getClientIp(request)},
      now() + (${terminalLoginExpiresIntervalSql})::interval
    )
    returning id::text, expires_at::text as "expiresAt"
  `;

  return {
    token,
    requestId: String(rows[0]?.id ?? ""),
    expiresAt: String(rows[0]?.expiresAt ?? "")
  };
}

export async function getTerminalLoginRequest(token: string) {
  const rows = await sql`
    update store_terminal_login_requests
    set status = case when status = 'pending' and expires_at <= now() then 'expired' else status end,
        updated_at = case when status = 'pending' and expires_at <= now() then now() else updated_at end
    where token_hash = ${hashTerminalLoginToken(token)}
    returning
      id::text,
      status,
      terminal_employee_id::text as "terminalEmployeeId",
      store_id::text as "storeId",
      approved_by::text as "approvedBy",
      approved_at::text as "approvedAt",
      consumed_at::text as "consumedAt",
      expires_at::text as "expiresAt"
  `;
  return rows[0] ?? null;
}

export async function getTerminalLoginStoreOptions(session: EmployeeSession): Promise<TerminalLoginStoreOption[]> {
  const scope = await getSessionStoreScope(session);
  const rows = scope.allStores ? await sql`
    select
      stores.id::text as "storeId",
      stores.name as "storeName",
      employees.id::text as "terminalEmployeeId",
      employees.name as "terminalName",
      coalesce(employees.login_id, employees.email, '') as "terminalLoginId"
    from stores
    join employee_scopes on employee_scopes.store_id = stores.id and employee_scopes.scope_type = 'store'
    join employees on employees.id = employee_scopes.employee_id
    where stores.status = 'active'
      and employees.status = 'active'
      and employees.role = 'store_terminal'
    order by stores.name, employees.name
  ` : await sql`
    select
      stores.id::text as "storeId",
      stores.name as "storeName",
      employees.id::text as "terminalEmployeeId",
      employees.name as "terminalName",
      coalesce(employees.login_id, employees.email, '') as "terminalLoginId"
    from stores
    join employee_scopes on employee_scopes.store_id = stores.id and employee_scopes.scope_type = 'store'
    join employees on employees.id = employee_scopes.employee_id
    where stores.status = 'active'
      and stores.id::text = any(${scope.storeIds})
      and employees.status = 'active'
      and employees.role = 'store_terminal'
    order by stores.name, employees.name
  `;

  const byStore = new Map<string, TerminalLoginStoreOption>();
  for (const row of rows) {
    const storeId = String(row.storeId);
    const store = byStore.get(storeId) ?? {
      id: storeId,
      name: String(row.storeName ?? ""),
      terminalAccounts: []
    };
    store.terminalAccounts.push({
      id: String(row.terminalEmployeeId),
      name: String(row.terminalName ?? ""),
      loginId: String(row.terminalLoginId ?? "")
    });
    byStore.set(storeId, store);
  }
  return Array.from(byStore.values());
}

export async function approveTerminalLoginRequest(input: {
  token: string;
  approver: EmployeeSession;
  storeId: string;
  terminalEmployeeId: string;
}) {
  if (!canApproveTerminalLogin(input.approver)) {
    return { error: "店舗端末ログインを承認する権限がありません。", status: 403 };
  }

  const stores = await getTerminalLoginStoreOptions(input.approver);
  const store = stores.find((candidate) => candidate.id === input.storeId);
  if (!store) {
    return { error: "承認できる店舗を選択してください。", status: 403 };
  }
  const terminal = store.terminalAccounts.find((candidate) => candidate.id === input.terminalEmployeeId);
  if (!terminal) {
    return { error: "選択した店舗の店舗Padアカウントを選択してください。", status: 400 };
  }

  const rows = await sql`
    update store_terminal_login_requests
    set status = 'approved',
        terminal_employee_id = ${input.terminalEmployeeId},
        store_id = ${input.storeId},
        approved_by = ${input.approver.id},
        approved_at = now(),
        updated_at = now()
    where token_hash = ${hashTerminalLoginToken(input.token)}
      and status = 'pending'
      and expires_at > now()
    returning id::text
  `;

  if (!rows.length) {
    return { error: "QRコードの有効期限が切れたか、すでに使用されています。", status: 400 };
  }

  return { ok: true, storeName: store.name, terminalName: terminal.name };
}

export async function consumeApprovedTerminalLogin(token: string, request: Request) {
  const requestRows = await sql`
    update store_terminal_login_requests
    set status = 'consumed',
        consumed_at = now(),
        updated_at = now()
    where token_hash = ${hashTerminalLoginToken(token)}
      and status = 'approved'
      and expires_at > now()
      and consumed_at is null
    returning terminal_employee_id::text as "terminalEmployeeId"
  `;
  const terminalEmployeeId = String(requestRows[0]?.terminalEmployeeId ?? "");
  if (!terminalEmployeeId) return null;

  const employeeRows = await sql`
    select
      id::text,
      name,
      coalesce(login_id, email, '') as "loginId",
      role,
      session_version as "sessionVersion"
    from employees
    where id = ${terminalEmployeeId}
      and status = 'active'
      and role = 'store_terminal'
    limit 1
  `;
  const employee = employeeRows[0] as EmployeeSession | undefined;
  if (!employee) return null;

  const permissionSet = await getPermissionsForRole(employee.role);
  const permissions = Array.from(permissionSet);
  const sessionId = await createEmployeeSession({
    employeeId: employee.id,
    role: employee.role,
    sessionVersion: employee.sessionVersion,
    surface: "store",
    request
  });
  const tokenValue = createSessionToken({
    ...employee,
    sessionId,
    permissions,
    permittedNavPaths: getNavPathsForPermissions(permissions)
  });

  return {
    cookie: `${authCookieName}=${tokenValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionCookieMaxAge()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    employee: {
      name: employee.name,
      loginId: employee.loginId,
      role: employee.role,
      permissions,
      permittedNavPaths: getNavPathsForPermissions(permissions)
    }
  };
}
