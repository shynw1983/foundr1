"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, LogOut, MessageSquareWarning, PackageCheck, Search, Store, Truck, UserCog } from "lucide-react";
import type { FormEvent, MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";

type StoreOption = {
  id: string;
  name: string;
  companyName?: string | null;
};

type WorkStoreOption = StoreOption & {
  payrollEnabled?: boolean | null;
  employmentType?: string | null;
  hourlyWage?: number | string | null;
  monthlySalary?: number | string | null;
  commuteAllowancePerWorkday?: number | string | null;
};

type StaffMember = {
  id: string;
  name: string;
  loginId: string;
  email: string | null;
  larkOpenId?: string | null;
  larkUserId?: string | null;
  role: string;
  staffCategory: string;
  payrollSubject: string;
  status: string;
  lastSeenAt?: string | null;
  employmentType?: string | null;
  hourlyWage?: number | string | null;
  monthlySalary?: number | string | null;
  commuteAllowancePerWorkday?: number | string | null;
  payrollEnabled?: boolean | null;
  stores: StoreOption[];
  visibleStores?: StoreOption[];
  workStores?: WorkStoreOption[];
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "発注管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  store_owner: "加盟店オーナー",
  buyer: "購入担当",
  staff: "店舗スタッフ"
};

const staffCategoryLabels: Record<string, string> = {
  executive: "経営層",
  management: "管理層",
  working: "実勤務スタッフ"
};

const payrollSubjectLabels: Record<string, string> = {
  paid: "給与計算あり",
  unpaid: "給与計算なし",
  none: "給与対象外"
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

function getPresenceState(lastSeenAt?: string | null) {
  if (!lastSeenAt) return { label: "オフライン", tone: "is-offline" };

  const elapsedMinutes = (Date.now() - new Date(lastSeenAt).getTime()) / 60_000;
  if (!Number.isFinite(elapsedMinutes)) return { label: "オフライン", tone: "is-offline" };
  if (elapsedMinutes <= 5) return { label: "オンライン", tone: "is-online" };
  if (elapsedMinutes <= 30) return { label: "離席中", tone: "is-away" };

  return { label: "オフライン", tone: "is-offline" };
}

function formatLastSeen(lastSeenAt?: string | null) {
  if (!lastSeenAt) return "最終アクセス 未記録";

  return `最終アクセス ${new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(lastSeenAt))}`;
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
  const onlineCount = useMemo(() => staff.filter((member) => getPresenceState(member.lastSeenAt).label === "オンライン").length, [staff]);

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
      larkOpenId: String(formData.get("larkOpenId") ?? ""),
      larkUserId: String(formData.get("larkUserId") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "staff"),
      staffCategory: String(formData.get("staffCategory") ?? "working"),
      payrollSubject: String(formData.get("payrollSubject") ?? "none"),
      employmentType: String(formData.get("employmentType") ?? "hourly"),
      hourlyWage: String(formData.get("hourlyWage") ?? ""),
      monthlySalary: String(formData.get("monthlySalary") ?? ""),
      commuteAllowancePerWorkday: String(formData.get("commuteAllowancePerWorkday") ?? "0"),
      status: String(formData.get("status") ?? "active"),
      visibleStoreIds: formData.getAll("visibleStoreIds").map((value) => String(value)),
      workStoreIds: formData.getAll("workStoreIds").map((value) => String(value)),
      workStoreSettings: stores.map((store) => ({
        storeId: store.id,
        payrollEnabled: formData.getAll("payrollEnabledStoreIds").map((value) => String(value)).includes(store.id),
        employmentType: String(formData.get(`employmentType:${store.id}`) ?? "hourly"),
        hourlyWage: String(formData.get(`hourlyWage:${store.id}`) ?? ""),
        monthlySalary: String(formData.get(`monthlySalary:${store.id}`) ?? ""),
        commuteAllowancePerWorkday: String(formData.get(`commuteAllowancePerWorkday:${store.id}`) ?? "0")
      }))
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
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">社員アカウントと店舗権限</p>
            <h2>スタッフ管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : dataSource === "forbidden" ? "Owner 権限が必要" : "読み込み中"}</span>
          </div>
        </header>

        {dataSource === "forbidden" ? (
          <section className="panel">
            <PanelTitle title="Owner 権限が必要です" subtitle="スタッフ管理は Owner アカウントでログインした場合のみ操作できます。" />
          </section>
        ) : (
          <section className="management-grid staff-management-grid">
            <section className="panel">
              <PanelTitle title="スタッフ一覧" subtitle={`登録 ${staff.length} 名・有効 ${activeCount} 名・オンライン ${onlineCount} 名`} />
              <div className="management-list">
                {staff.map((member) => (
                  <article className="management-row staff-row" key={member.id}>
                    <div>
                      <div className="staff-row-heading">
                        <strong>{member.name}</strong>
                        <span className={`presence-pill ${getPresenceState(member.lastSeenAt).tone}`}>
                          {getPresenceState(member.lastSeenAt).label}
                        </span>
                      </div>
                      <p>{member.loginId} / {roleLabels[member.role] ?? member.role} / {staffCategoryLabels[member.staffCategory] ?? member.staffCategory}</p>
                      <small>
                        {member.status === "active" ? "有効" : "停止中"} ・ {payrollSubjectLabels[member.payrollSubject] ?? member.payrollSubject} ・ 閲覧: {getVisibleStores(member).length ? getVisibleStores(member).map((store) => store.name).join("、") : "全店舗"} ・ 勤務: {getWorkStores(member).length ? getWorkStores(member).map((store) => store.name).join("、") : "未設定"} ・ {formatLastSeen(member.lastSeenAt)}
                        {member.larkOpenId || member.larkUserId ? " ・ Lark 連携済み" : ""}
                      </small>
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

function getVisibleStores(member: StaffMember) {
  return member.visibleStores ?? member.stores ?? [];
}

function getWorkStores(member: StaffMember) {
  return member.workStores ?? [];
}

function StaffFormFields({ member, stores, currentUserId }: { member?: StaffMember; stores: StoreOption[]; currentUserId?: string }) {
  const selectedVisibleStoreIds = new Set(member ? getVisibleStores(member).map((store) => store.id) : []);
  const selectedWorkStoreIds = new Set(member ? getWorkStores(member).map((store) => store.id) : []);
  const workStoreById = new Map((member ? getWorkStores(member) : []).map((store) => [store.id, store]));
  const isSelf = Boolean(member && member.id === currentUserId);
  const [larkStatus, setLarkStatus] = useState("");
  const [activeTab, setActiveTab] = useState<"basic" | "payroll" | "other">("basic");

  async function lookupLarkUser(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;

    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    if (!email) {
      setLarkStatus("メールを入力してください。");
      return;
    }

    setLarkStatus("Lark を確認中...");
    const response = await fetch("/api/staff/lark-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: member?.id,
        email
      })
    });
    const body = await response.json().catch(() => ({})) as {
      openId?: string;
      userId?: string;
      testDelivered?: boolean;
      testError?: string;
      error?: string;
    };

    if (!response.ok || !body.openId) {
      setLarkStatus(body.error ?? "Lark ユーザーを確認できませんでした。");
      return;
    }

    const openIdInput = form.elements.namedItem("larkOpenId") as HTMLInputElement | null;
    const userIdInput = form.elements.namedItem("larkUserId") as HTMLInputElement | null;
    if (openIdInput) openIdInput.value = body.openId;
    if (userIdInput) userIdInput.value = body.userId ?? "";
    setLarkStatus(body.testDelivered ? "Lark 連携を確認しました。" : `open_id を取得しました。${body.testError ? ` テスト送信: ${body.testError}` : ""}`);
  }

  return (
    <>
      <div className="staff-form-tabs" role="tablist" aria-label="スタッフ情報">
        <button className={activeTab === "basic" ? "is-active" : ""} type="button" onClick={() => setActiveTab("basic")}>基本情報</button>
        <button className={activeTab === "payroll" ? "is-active" : ""} type="button" onClick={() => setActiveTab("payroll")}>給与情報</button>
        <button className={activeTab === "other" ? "is-active" : ""} type="button" onClick={() => setActiveTab("other")}>その他</button>
      </div>

      <section className={activeTab === "basic" ? "staff-form-pane is-active" : "staff-form-pane"}>
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
            <option value="store_owner">加盟店オーナー</option>
            <option value="buyer">購入担当</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <label>
          <span>スタッフ区分</span>
          <select name="staffCategory" defaultValue={member?.staffCategory ?? "working"}>
            <option value="executive">経営層</option>
            <option value="management">管理層</option>
            <option value="working">実勤務スタッフ</option>
          </select>
        </label>
        <label>
          <span>状態</span>
          <select name="status" defaultValue={member?.status ?? "active"} disabled={isSelf}>
            <option value="active">有効</option>
            <option value="inactive">停止中</option>
          </select>
        </label>
      </section>

      <section className={activeTab === "payroll" ? "staff-form-pane is-active" : "staff-form-pane"}>
        <label>
          <span>給与対象</span>
          <select name="payrollSubject" defaultValue={member?.payrollSubject ?? "none"}>
            <option value="paid">給与計算あり</option>
            <option value="unpaid">給与計算なし</option>
            <option value="none">給与対象外</option>
          </select>
        </label>
        <input name="employmentType" type="hidden" value={member?.employmentType ?? "hourly"} readOnly />
        <input name="hourlyWage" type="hidden" value={String(member?.hourlyWage ?? "")} readOnly />
        <input name="monthlySalary" type="hidden" value={String(member?.monthlySalary ?? "")} readOnly />
        <input name="commuteAllowancePerWorkday" type="hidden" value={String(member?.commuteAllowancePerWorkday ?? 0)} readOnly />
        <div className="staff-payroll-store-list">
          {stores.length ? stores.map((store) => {
            const setting = workStoreById.get(store.id);
            const defaultEmploymentType = setting?.employmentType ?? member?.employmentType ?? "hourly";
            return (
              <article className="staff-payroll-store-row" key={store.id}>
                <label className="staff-payroll-store-toggle">
                  <input type="checkbox" name="workStoreIds" value={store.id} defaultChecked={selectedWorkStoreIds.has(store.id)} />
                  <span>
                    <strong>{store.name}</strong>
                    <small>{store.companyName ?? "会社未設定"}</small>
                  </span>
                </label>
                <label>
                  <span>給与計算</span>
                  <span className="staff-payroll-check">
                    <input type="checkbox" name="payrollEnabledStoreIds" value={store.id} defaultChecked={selectedWorkStoreIds.has(store.id) && setting?.payrollEnabled !== false} />
                    対象
                  </span>
                </label>
                <label>
                  <span>給与形態</span>
                  <select name={`employmentType:${store.id}`} defaultValue={defaultEmploymentType === "monthly" ? "monthly" : "hourly"}>
                    <option value="hourly">時給</option>
                    <option value="monthly">月給</option>
                  </select>
                </label>
                <label>
                  <span>時給</span>
                  <input name={`hourlyWage:${store.id}`} type="number" min="0" step="1" defaultValue={setting?.hourlyWage ?? member?.hourlyWage ?? ""} placeholder="例: 1200" />
                </label>
                <label>
                  <span>月給</span>
                  <input name={`monthlySalary:${store.id}`} type="number" min="0" step="1" defaultValue={setting?.monthlySalary ?? member?.monthlySalary ?? ""} placeholder="月給のみ" />
                </label>
                <label>
                  <span>交通費 / 勤務日</span>
                  <input name={`commuteAllowancePerWorkday:${store.id}`} type="number" min="0" step="1" defaultValue={setting?.commuteAllowancePerWorkday ?? member?.commuteAllowancePerWorkday ?? 0} />
                </label>
              </article>
            );
          }) : <p className="empty-state-text">店舗データがありません。</p>}
        </div>
      </section>

      <section className={activeTab === "other" ? "staff-form-pane is-active" : "staff-form-pane"}>
        <fieldset className="checkbox-group staff-store-scope">
          <span>閲覧可能店舗</span>
          {stores.length ? stores.map((store) => (
            <label key={store.id}>
              <input type="checkbox" name="visibleStoreIds" value={store.id} defaultChecked={selectedVisibleStoreIds.has(store.id)} />
              {store.name}
            </label>
          )) : <small>店舗データがありません。</small>}
        </fieldset>
        <label>
          <span>Lark open_id</span>
          <input name="larkOpenId" defaultValue={member?.larkOpenId ?? ""} placeholder="任意" />
        </label>
        <label>
          <span>Lark user_id</span>
          <input name="larkUserId" defaultValue={member?.larkUserId ?? ""} placeholder="任意" />
        </label>
        <div className="staff-lark-lookup">
          <button className="secondary-button" type="button" onClick={lookupLarkUser}>
            Lark 連携を確認
          </button>
          {larkStatus ? <small>{larkStatus}</small> : null}
        </div>
      </section>
    </>
  );
}
