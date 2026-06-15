import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);
const tables = [
  "stores",
  "brands",
  "store_brands",
  "employees",
  "employee_sessions",
  "store_terminal_login_requests",
  "employee_scopes",
  "products",
  "product_brand_usages",
  "suppliers",
  "supplier_locations",
  "product_supplier_options",
  "purchase_orders",
  "purchase_order_items",
  "purchase_actuals",
  "purchase_exceptions",
  "procurement_staff_unavailable_slots",
  "price_records",
  "os_audit_logs",
  "os_notifications",
  "role_permissions",
  "employee_work_stores",
  "timecard_store_settings",
  "timecard_employee_settings",
  "timecard_punches",
  "timecard_shifts",
  "timecard_payroll_confirmations",
  "timecard_workload_settings",
  "employee_lifecycle_cases",
  "employee_lifecycle_tasks",
  "employee_lifecycle_documents"
];

const requiredColumns = {
  employee_sessions: [
    "employee_id",
    "session_version",
    "surface",
    "user_agent",
    "ip_address",
    "last_seen_at",
    "expires_at",
    "revoked_at",
    "revoked_reason"
  ],
  store_terminal_login_requests: [
    "token_hash",
    "status",
    "terminal_employee_id",
    "store_id",
    "approved_by",
    "approved_at",
    "consumed_at",
    "expires_at"
  ],
  role_permissions: [
    "role",
    "permission_key",
    "is_enabled",
    "updated_by",
    "updated_at"
  ],
  employee_lifecycle_cases: [
    "employee_id",
    "case_type",
    "title",
    "status",
    "store_id",
    "started_at",
    "completed_at",
    "created_by",
    "updated_by"
  ],
  employee_lifecycle_tasks: [
    "lifecycle_case_id",
    "task_key",
    "title",
    "description",
    "status",
    "assignee_employee_id",
    "due_date",
    "completed_at",
    "completed_by",
    "note",
    "required_document_types",
    "sort_order"
  ],
  employee_lifecycle_documents: [
    "lifecycle_case_id",
    "lifecycle_task_id",
    "document_type",
    "file_name",
    "file_url",
    "file_size_bytes",
    "content_type",
    "uploaded_by",
    "uploaded_at",
    "note"
  ]
};

const rows = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name = any(${tables})
  order by table_name
`;

const existingTables = new Set(rows.map((row) => row.table_name));
const requiredColumnTables = Object.keys(requiredColumns).filter((tableName) => existingTables.has(tableName));
const columnRows = requiredColumnTables.length ? await sql`
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = any(${requiredColumnTables})
  order by table_name, ordinal_position
` : [];
const existingColumns = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
const missingColumns = Object.entries(requiredColumns).flatMap(([tableName, columns]) => (
  columns
    .filter((columnName) => existingTables.has(tableName) && !existingColumns.has(`${tableName}.${columnName}`))
    .map((columnName) => `${tableName}.${columnName}`)
));

console.log(JSON.stringify({
  tables: rows.map((row) => row.table_name),
  missingTables: tables.filter((tableName) => !existingTables.has(tableName)),
  missingColumns
}, null, 2));

if (tables.some((tableName) => !existingTables.has(tableName)) || missingColumns.length > 0) {
  process.exitCode = 1;
}
