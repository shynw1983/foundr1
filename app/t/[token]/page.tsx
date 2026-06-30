import { notFound } from "next/navigation";
import { sql } from "../../../lib/db";

export const dynamic = "force-dynamic";

type TableOrderPageProps = {
  params: Promise<{ token: string }>;
};

export default async function TableOrderPage({ params }: TableOrderPageProps) {
  const { token } = await params;
  const rows = await sql`
    select
      store_tables.label as "tableLabel",
      coalesce(nullif(store_tables.display_name, ''), store_tables.label) as "tableDisplayName",
      stores.name as "storeName",
      coalesce(brands.name, '') as "brandName",
      store_tables.table_ordering_enabled as "tableOrderingEnabled",
      coalesce(pos_store_settings.dine_in_enabled, true) as "dineInEnabled"
    from store_tables
    join stores on stores.id = store_tables.store_id
    left join brands on brands.id = store_tables.brand_id
    left join pos_store_settings on pos_store_settings.store_id = stores.id
    where store_tables.qr_token = ${token}
      and store_tables.status = 'active'
      and stores.status = 'active'
      and (brands.id is null or brands.status = 'active')
    limit 1
  `;
  const table = rows[0];
  if (!table) notFound();

  const orderingEnabled = table.tableOrderingEnabled === true && table.dineInEnabled === true;

  return (
    <main className="table-order-shell">
      <section className="table-order-panel">
        <p className="table-order-kicker">{table.brandName || "Foundr1 OS"}</p>
        <h1>{table.storeName}</h1>
        <p className="table-order-table">テーブル {table.tableDisplayName || table.tableLabel}</p>
        <div className={orderingEnabled ? "table-order-status is-open" : "table-order-status"}>
          {orderingEnabled ? "テーブル注文の準備ができています" : "このテーブルでは現在注文できません"}
        </div>
        <p className="table-order-note">
          メニューと追加注文の画面は次のステップで接続します。
        </p>
      </section>
    </main>
  );
}
