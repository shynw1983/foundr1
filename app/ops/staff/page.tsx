"use client";

import { Boxes, ClipboardList, FileText, LogOut, MessageSquareWarning, PackageCheck, Store, Truck, UserCog } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";

type StoreOption = {
  id: string;
  name: string;
};

type StaffMember = {
  id: string;
  name: string;
  loginId: string;
  email: string | null;
  role: string;
  status: string;
  stores: StoreOption[];
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "仕入れ依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "仕入れ処理", href: "/ops/procurement", icon: ClipboardList },
  { label: "仕入れ一覧", href: "/ops/history", icon: FileText },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "スタッフ管理", href: "/ops/staff", icon: UserCog },
  { label: "仕入れ先管理", href: "/ops/suppliers", icon: Truck },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  buyer: "仕入れ担当",
  staff: "店舗スタッフ"
};

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-title">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [dataSource, setDataSource] = useState<"loading" | "neon" | "forbidden">("loading");
  const [error, setError] = useState("");

  const activeCount = useMemo(() => staff.filter((member) => member.status === "active").length, [staff]);

  async function loadStaff() {
    const response = await fetch("/api/staff");
    if (response.status === 403) {
      setDataSource("forbidden");
      return;
    }
    if (!response.ok) return;

    const body = await response.json() as {
      employees?: StaffMember[];
      stores?: StoreOption[];
      currentUserId?: string;
    };
    setStaff(body.employees ?? []);
    setStores(body.stores ?? []);
    setCurrentUserId(body.currentUserId ?? "");
    setDataSource("neon");
  }

  useEffect(() => {
    void loadStaff();
  }, []);

  function readForm(form: HTMLFormElement) {
    const formData = new FormData(form);
    return {
      name: String(formData.get("name") ?? ""),
      loginId: String(formData.get("loginId") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "staff"),
      status: String(formData.get("status") ?? "active"),
      storeIds: formData.getAll("storeIds").map((value) => String(value))
    };
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const response = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readForm(form))
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "スタッフを保存できませんでした。");
      return;
    }

    form.reset();
    await loadStaff();
    showNotice("スタッフを追加しました。");
  }

  async function updateStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingStaff) return;
    setError("");
    const response = await fetch(`/api/staff/${editingStaff.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readForm(event.currentTarget))
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "スタッフを更新できませんでした。");
      return;
    }

    setEditingStaff(null);
    await loadStaff();
    showNotice("スタッフを更新しました。");
  }

  async function deleteStaff(member: StaffMember) {
    if (!window.confirm(`${member.name} を削除しますか？`)) return;

    const response = await fetch(`/api/staff/${member.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      window.alert(body.error ?? "スタッフを削除できませんでした。");
      return;
    }

    await loadStaff();
    showNotice("スタッフを削除しました。");
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <div className="brand-block">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Ops</p>
            <h1>仕入れ管理</h1>
          </div>
        </div>
        <MobileNavMenu navItems={navItems} />
        <nav className="nav-list">
          {navItems.map(({ label, href, icon: Icon }) => (
            <a href={href} className="nav-item" key={label}>
              <Icon size={18} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">社員アカウントと店舗権限</p>
            <h2>スタッフ管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : dataSource === "forbidden" ? "Owner 権限が必要" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <UserBadge />
          </div>
        </header>

        {dataSource === "forbidden" ? (
          <section className="panel">
            <PanelTitle title="Owner 権限が必要です" subtitle="スタッフ管理は Owner アカウントでログインした場合のみ操作できます。" />
          </section>
        ) : (
          <section className="management-grid staff-management-grid">
            <section className="panel">
              <PanelTitle title="スタッフ一覧" subtitle={`登録 ${staff.length} 名・有効 ${activeCount} 名`} />
              <div className="management-list">
                {staff.map((member) => (
                  <article className="management-row staff-row" key={member.id}>
                    <div>
                      <strong>{member.name}</strong>
                      <p>{member.loginId} / {roleLabels[member.role] ?? member.role}</p>
                      <small>{member.status === "active" ? "有効" : "停止中"} ・ {member.stores.length ? member.stores.map((store) => store.name).join("、") : "全店舗または未設定"}</small>
                    </div>
                    <div className="row-actions">
                      <button className="secondary-button" type="button" onClick={() => setEditingStaff(member)}>
                        編集
                      </button>
                      <button className="danger-button" type="button" disabled={member.id === currentUserId} onClick={() => deleteStaff(member)}>
                        削除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <PanelTitle title="スタッフ追加" subtitle="ログインID、初期パスワード、店舗権限を設定" />
              {error ? <div className="login-error">{error}</div> : null}
              <form className="management-form staff-form" onSubmit={createStaff}>
                <StaffFormFields stores={stores} />
                <button className="primary-button" type="submit">追加</button>
              </form>
            </section>
          </section>
        )}
      </section>

      {editingStaff ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="staff-edit-title">
          <section className="edit-modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Staff</p>
                <h3 id="staff-edit-title">スタッフを編集</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => setEditingStaff(null)}>閉じる</button>
            </div>
            {error ? <div className="login-error">{error}</div> : null}
            <form className="management-form staff-form" onSubmit={updateStaff}>
              <StaffFormFields member={editingStaff} stores={stores} currentUserId={currentUserId} />
              <button className="primary-button" type="submit">保存</button>
            </form>
          </section>
        </div>
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function StaffFormFields({ member, stores, currentUserId }: { member?: StaffMember; stores: StoreOption[]; currentUserId?: string }) {
  const selectedStoreIds = new Set(member?.stores.map((store) => store.id) ?? []);
  const isSelf = Boolean(member && member.id === currentUserId);

  return (
    <>
      <label>
        <span>氏名</span>
        <input name="name" defaultValue={member?.name ?? ""} placeholder="例: 山田 太郎" required />
      </label>
      <label>
        <span>ログインID</span>
        <input name="loginId" defaultValue={member?.loginId ?? ""} placeholder="例: staff01" required />
      </label>
      <label>
        <span>メール</span>
        <input name="email" type="email" defaultValue={member?.email ?? ""} placeholder="任意" />
      </label>
      <label>
        <span>{member ? "新しいパスワード" : "初期パスワード"}</span>
        <input name="password" type="password" placeholder={member ? "変更時のみ入力" : "必須"} required={!member} />
      </label>
      <label>
        <span>権限</span>
        <select name="role" defaultValue={member?.role ?? "staff"}>
          <option value="staff">店舗スタッフ</option>
          <option value="buyer">仕入れ担当</option>
          <option value="manager">Manager</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <label>
        <span>状態</span>
        <select name="status" defaultValue={member?.status ?? "active"} disabled={isSelf}>
          <option value="active">有効</option>
          <option value="inactive">停止中</option>
        </select>
      </label>
      <fieldset className="checkbox-group staff-store-scope">
        <span>担当店舗</span>
        {stores.length ? stores.map((store) => (
          <label key={store.id}>
            <input type="checkbox" name="storeIds" value={store.id} defaultChecked={selectedStoreIds.has(store.id)} />
            {store.name}
          </label>
        )) : <small>店舗データがありません。</small>}
      </fieldset>
    </>
  );
}
