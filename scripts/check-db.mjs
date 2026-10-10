import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);
const tables = [
  "inventory_recipes",
  "inventory_recipe_versions",
  "inventory_recipe_version_products",
  "product_packaging_templates",
  "inventory_usage_settings",
  "inventory_product_usage_locations",
  "inventory_order_usage_events",
  "inventory_movements",
  "inventory_order_usage_issues",
  "inventory_transfers",
  "inventory_production_operations",

  "stores",
  "brands",
  "store_brands",
  "employees",
  "employee_sessions",
  "store_terminal_login_requests",
  "employee_scopes",
  "products",
  "product_catalog_store_grants",
  "menu_product_links",
  "inventory_locations",
  "inventory_items",
  "inventory_checks",
  "inventory_stock_receipts",
  "product_brand_usages",
  "suppliers",
  "supplier_locations",
  "product_supplier_options",
  "purchase_orders",
  "purchase_order_items",
  "purchase_actuals",
  "purchase_exceptions",
  "procurement_staff_unavailable_slots",
  "procurement_order_templates",
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
  "business_calendar_events",
  "employee_lifecycle_cases",
  "employee_lifecycle_tasks",
  "employee_lifecycle_documents"
];

const requiredColumns = {
  menu_product_links: ["menu_catalog_item_id", "menu_option_id", "product_id"],
  purchase_orders: ["replenishment_source"],
  products: ["catalog_visibility", "is_orderable", "inventory_unit_conversions"],
  product_catalog_store_grants: ["product_id", "store_id"],
  purchase_order_items: ["price_feedback_confirmation", "quantity_feedback_confirmation"],
  inventory_items: ["count_conversion_snapshot", "stock_quantity", "stock_conversion_snapshot", "stock_revision", "last_received_at", "quick_status", "quick_checked_at", "quick_checked_by", "quick_checked_by_name", "quick_estimate", "quick_basis", "quick_revision", "quick_superseded_at"],
  inventory_stock_receipts: ["request_id", "purchase_order_item_id", "inventory_item_id", "purchase_quantity", "conversion_snapshot", "source_snapshot", "request_payload"],
  inventory_checks: ["count_unit", "unit_conversion_snapshot", "quick_check_snapshot"],
  procurement_order_templates: ["store_id", "name", "items", "created_by", "status"],
  employees: [
    "my_number"
  ],
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
  ],
  business_calendar_events: [
    "store_id",
    "source_type",
    "source_key",
    "title",
    "start_date",
    "end_date",
    "start_time",
    "category",
    "impact_level",
    "venue",
    "prefecture",
    "locality",
    "source_url",
    "is_active"
  ]
};


requiredColumns.inventory_recipes = ["create_request_payload","brand_id", "kind", "target_type", "target_id", "output_product_id", "current_version_id", "status"];
requiredColumns.inventory_recipe_versions = ["recipe_id", "version", "snapshot"];
requiredColumns.inventory_recipe_version_products = ["recipe_version_id", "product_id"];
requiredColumns.product_packaging_templates = ["product_id", "supplier_id", "packaging", "create_request_payload", "status"];
requiredColumns.inventory_usage_settings = ["enabled", "enabled_from", "trigger_mode", "revision"];
requiredColumns.inventory_product_usage_locations = ["store_id", "product_id", "inventory_item_id"];
requiredColumns.inventory_order_usage_events = ["order_id", "store_id", "source_snapshot", "plan_snapshot", "occurred_at"];
requiredColumns.inventory_movements = ["operation_key", "store_id", "product_id", "inventory_item_id", "kind", "quantity", "count_unit", "confidence", "exposure", "occurred_at", "source_order_id", "source_order_item_id", "recipe_version_id", "changes_stock", "metadata"];
requiredColumns.inventory_order_usage_issues = ["order_id", "store_id", "code", "details", "resolved_at"];
requiredColumns.inventory_transfers = ["source_store_id", "target_store_id", "product_id", "quantity", "received_quantity", "unit", "status", "snapshot"];
requiredColumns.inventory_production_operations = ["request_id", "action", "recipe_version_id", "transfer_id", "request_payload", "snapshot"];

requiredColumns.store_customer_orders = [...(requiredColumns.store_customer_orders ?? []),"inventory_items_ready_at","inventory_source_snapshot","inventory_first_prepared_at","inventory_preparation_source_snapshot"];
requiredColumns.inventory_items = [...(requiredColumns.inventory_items ?? []),"usage_anchor_check_id"];
requiredColumns.inventory_checks = [...(requiredColumns.inventory_checks ?? []),"reconciliation_snapshot"];
requiredColumns.purchase_order_items = [...(requiredColumns.purchase_order_items ?? []),"actual_packaging_snapshot"];
requiredColumns.purchase_actuals = [...(requiredColumns.purchase_actuals ?? []),"packaging_snapshot"];
requiredColumns.price_records = [...(requiredColumns.price_records ?? []),"packaging_snapshot"];
requiredColumns.inventory_stock_receipts = [...(requiredColumns.inventory_stock_receipts ?? []),"batch_packaging_snapshot"];

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
