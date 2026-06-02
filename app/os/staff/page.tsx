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
  payrollCycleType?: string | null;
  payrollClosingDay?: number | null;
};

type WorkStoreOption = StoreOption & {
  employeeNumber?: string | null;
  hireDate?: string | null;
  resignationDate?: string | null;
  resignationReason?: string | null;
  businessType?: string | null;
  employeeType?: string | null;
  payrollEnabled?: boolean | null;
  employmentType?: string | null;
  hourlyWage?: number | string | null;
  monthlySalary?: number | string | null;
  commuteAllowancePerWorkday?: number | string | null;
  commuteAllowanceMonthlyCap?: number | string | null;
  applySocialInsurance?: boolean | null;
  socialInsuranceStandardMonthlyAmount?: number | string | null;
  socialInsuranceDeductionFrom?: string | null;
  applyEmploymentInsurance?: boolean | null;
  employmentInsuranceDeductionFrom?: string | null;
  applyLaborInsurance?: boolean | null;
  applyIncomeTax?: boolean | null;
  incomeTaxCategory?: string | null;
  dependentCount?: number | string | null;
  applyResidentTax?: boolean | null;
  residentTaxYear?: number | string | null;
  residentTaxJuneAmount?: number | string | null;
  residentTaxMonthlyAmount?: number | string | null;
  payrollHistory?: PayrollHistoryEntry[];
};

type PayrollHistoryEntry = {
  id?: string | null;
  validFrom?: string | null;
  payrollEnabled?: boolean | null;
  employmentType?: string | null;
  hourlyWage?: number | string | null;
  monthlySalary?: number | string | null;
  commuteAllowancePerWorkday?: number | string | null;
  commuteAllowanceMonthlyCap?: number | string | null;
  applySocialInsurance?: boolean | null;
  applyEmploymentInsurance?: boolean | null;
  applyLaborInsurance?: boolean | null;
  applyIncomeTax?: boolean | null;
  incomeTaxCategory?: string | null;
  dependentCount?: number | string | null;
  applyResidentTax?: boolean | null;
  residentTaxYear?: number | string | null;
  residentTaxJuneAmount?: number | string | null;
  residentTaxMonthlyAmount?: number | string | null;
  wageValidFrom?: string | null;
  commuteValidFrom?: string | null;
};

type StaffMember = {
  id: string;
  name: string;
  loginId: string;
  email: string | null;
  gender?: string | null;
  nameKana?: string | null;
  address?: string | null;
  birthDate?: string | null;
  isForeignNational?: boolean | null;
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
  commuteAllowanceMonthlyCap?: number | string | null;
  payrollEnabled?: boolean | null;
  stores: StoreOption[];
  visibleStores?: StoreOption[];
  workStores?: WorkStoreOption[];
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
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
  management: "管理職",
  working: "実勤務スタッフ"
};

const payrollSubjectLabels: Record<string, string> = {
  paid: "給与計算あり",
  unpaid: "給与計算なし",
  none: "給与対象外"
};

const genderLabels: Record<string, string> = {
  unspecified: "未設定",
  male: "男性",
  female: "女性",
  other: "その他"
};

const employeeTypeLabels: Record<string, string> = {
  full_time: "正社員",
  part_time: "アルバイト"
};

const ALL_FILTER = "__all__";
const UNKNOWN_COMPANY = "会社未設定";

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

function toDateInputValue(value?: string | null) {
  return value ? String(value).slice(0, 10) : "";
}

function formatPayrollAmount(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return "-";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "-";
  return `${numberValue.toLocaleString("ja-JP")}円`;
}

function formatPayrollMonth(value?: string | null, store?: StoreOption) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return "";
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const closingDay = Math.max(1, Math.min(30, Math.round(Number(store?.payrollClosingDay ?? 31) || 31)));
  const date = new Date(Date.UTC(year, monthIndex, 1));
  if (store?.payrollCycleType === "specified_day" && day > closingDay) {
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatPayrollMonthLabel(value?: string | null, store?: StoreOption) {
  const month = formatPayrollMonth(value, store);
  return month ? `${month.replace("-", "/")} 月度〜` : "未設定";
}

export default function StaffPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [dataSource, setDataSource] = useState<"loading" | "neon" | "forbidden">("loading");
  const [error, setError] = useState("");
  const [companyFilter, setCompanyFilter] = useState(ALL_FILTER);
  const [storeFilter, setStoreFilter] = useState(ALL_FILTER);
  const [positionFilter, setPositionFilter] = useState(ALL_FILTER);

  const activeCount = useMemo(() => staff.filter((member) => member.status === "active").length, [staff]);
  const onlineCount = useMemo(() => staff.filter((member) => getPresenceState(member.lastSeenAt).label === "オンライン").length, [staff]);
  const companyOptions = useMemo(() => {
    return Array.from(new Set(stores.map((store) => store.companyName?.trim() || UNKNOWN_COMPANY))).sort((a, b) => a.localeCompare(b, "ja"));
  }, [stores]);
  const storeOptions = useMemo(() => {
    if (companyFilter === ALL_FILTER) return stores;
    return stores.filter((store) => (store.companyName?.trim() || UNKNOWN_COMPANY) === companyFilter);
  }, [companyFilter, stores]);
  const filteredStaff = useMemo(() => {
    return staff.filter((member) => {
      const memberStores = getMemberStores(member);
      const hasCompany = companyFilter === ALL_FILTER || memberStores.some((store) => (store.companyName?.trim() || UNKNOWN_COMPANY) === companyFilter);
      const hasStore = storeFilter === ALL_FILTER || memberStores.some((store) => store.id === storeFilter);
      const hasPosition = positionFilter === ALL_FILTER
        || (positionFilter.startsWith("category:") && member.staffCategory === positionFilter.replace("category:", ""))
        || (positionFilter.startsWith("role:") && member.role === positionFilter.replace("role:", ""));

      return hasCompany && hasStore && hasPosition;
    });
  }, [companyFilter, positionFilter, staff, storeFilter]);
  const filteredActiveCount = useMemo(() => filteredStaff.filter((member) => member.status === "active").length, [filteredStaff]);
  const filteredOnlineCount = useMemo(() => filteredStaff.filter((member) => getPresenceState(member.lastSeenAt).label === "オンライン").length, [filteredStaff]);

  useEffect(() => {
    if (storeFilter !== ALL_FILTER && !storeOptions.some((store) => store.id === storeFilter)) {
      setStoreFilter(ALL_FILTER);
    }
  }, [storeFilter, storeOptions]);

  async function loadStaff() {
    const response = await fetch("/api/staff");
    if (response.status === 403) {
      setDataSource("forbidden");
      return [];
    }
    if (!response.ok) return [];

    const body = await response.json() as {
      employees?: StaffMember[];
      stores?: StoreOption[];
      currentUserId?: string;
    };
    setStaff(body.employees ?? []);
    setStores(body.stores ?? []);
    setCurrentUserId(body.currentUserId ?? "");
    setDataSource("neon");
    return body.employees ?? [];
  }

  useEffect(() => {
    void loadStaff();
  }, []);

  function readForm(form: HTMLFormElement) {
    const formData = new FormData(form);
    const workStoreIds = formData.getAll("workStoreIds").map((value) => String(value));
    const payrollEnabledStoreIds = new Set(formData.getAll("payrollEnabledStoreIds").map((value) => String(value)));
    const payrollSubject = workStoreIds.length === 0
      ? "none"
      : workStoreIds.some((storeId) => payrollEnabledStoreIds.has(storeId))
        ? "paid"
        : "unpaid";

    return {
      name: String(formData.get("name") ?? ""),
      loginId: String(formData.get("loginId") ?? ""),
      email: String(formData.get("email") ?? ""),
      gender: String(formData.get("gender") ?? "unspecified"),
      nameKana: String(formData.get("nameKana") ?? ""),
      address: String(formData.get("address") ?? ""),
      birthDate: String(formData.get("birthDate") ?? ""),
      isForeignNational: formData.get("isForeignNational") === "true",
      larkOpenId: String(formData.get("larkOpenId") ?? ""),
      larkUserId: String(formData.get("larkUserId") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "staff"),
      staffCategory: String(formData.get("staffCategory") ?? "working"),
      payrollSubject,
      employmentType: String(formData.get("employmentType") ?? "hourly"),
      hourlyWage: String(formData.get("hourlyWage") ?? ""),
      monthlySalary: String(formData.get("monthlySalary") ?? ""),
      commuteAllowancePerWorkday: String(formData.get("commuteAllowancePerWorkday") ?? "0"),
      commuteAllowanceMonthlyCap: String(formData.get("commuteAllowanceMonthlyCap") ?? ""),
      status: String(formData.get("status") ?? "active"),
      visibleStoreIds: formData.getAll("visibleStoreIds").map((value) => String(value)),
      workStoreIds,
      workStoreSettings: stores.map((store) => ({
        storeId: store.id,
        employeeNumber: String(formData.get(`employeeNumber:${store.id}`) ?? ""),
        hireDate: String(formData.get(`hireDate:${store.id}`) ?? ""),
        resignationDate: String(formData.get(`resignationDate:${store.id}`) ?? ""),
        resignationReason: String(formData.get(`resignationReason:${store.id}`) ?? ""),
        businessType: String(formData.get(`businessType:${store.id}`) ?? ""),
        employeeType: String(formData.get(`employeeType:${store.id}`) ?? "part_time"),
        payrollEnabled: payrollEnabledStoreIds.has(store.id),
        employmentType: String(formData.get(`employmentType:${store.id}`) ?? "hourly"),
        hourlyWage: String(formData.get(`hourlyWage:${store.id}`) ?? ""),
        monthlySalary: String(formData.get(`monthlySalary:${store.id}`) ?? ""),
        commuteAllowancePerWorkday: String(formData.get(`commuteAllowancePerWorkday:${store.id}`) ?? "0"),
        commuteAllowanceMonthlyCap: String(formData.get(`commuteAllowanceMonthlyCap:${store.id}`) ?? ""),
        applySocialInsurance: formData.getAll("applySocialInsuranceStoreIds").map((value) => String(value)).includes(store.id),
        socialInsuranceStandardMonthlyAmount: String(formData.get(`socialInsuranceStandardMonthlyAmount:${store.id}`) ?? ""),
        socialInsuranceDeductionFromMonth: String(formData.get(`socialInsuranceDeductionFromMonth:${store.id}`) ?? ""),
        applyEmploymentInsurance: formData.getAll("applyEmploymentInsuranceStoreIds").map((value) => String(value)).includes(store.id),
        employmentInsuranceDeductionFromMonth: String(formData.get(`employmentInsuranceDeductionFromMonth:${store.id}`) ?? ""),
        applyLaborInsurance: formData.getAll("applyLaborInsuranceStoreIds").map((value) => String(value)).includes(store.id),
        applyIncomeTax: formData.getAll("applyIncomeTaxStoreIds").map((value) => String(value)).includes(store.id),
        incomeTaxCategory: String(formData.get(`incomeTaxCategory:${store.id}`) ?? "none"),
        dependentCount: String(formData.get(`dependentCount:${store.id}`) ?? "0"),
        applyResidentTax: formData.getAll("applyResidentTaxStoreIds").map((value) => String(value)).includes(store.id),
        residentTaxYear: String(formData.get(`residentTaxYear:${store.id}`) ?? ""),
        residentTaxJuneAmount: String(formData.get(`residentTaxJuneAmount:${store.id}`) ?? ""),
        residentTaxMonthlyAmount: String(formData.get(`residentTaxMonthlyAmount:${store.id}`) ?? ""),
        wageValidFromMonth: String(formData.get(`wageValidFromMonth:${store.id}`) ?? ""),
        commuteValidFromMonth: String(formData.get(`commuteValidFromMonth:${store.id}`) ?? "")
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

  async function reloadStaffKeepingEdit(employeeId: string) {
    const employees = await loadStaff();
    setEditingStaff((current) => {
      if (!current || current.id !== employeeId) return current;
      return employees.find((member) => member.id === employeeId) ?? current;
    });
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
              <PanelTitle title="スタッフ一覧" subtitle={`表示 ${filteredStaff.length} 名 / 登録 ${staff.length} 名・有効 ${filteredActiveCount}/${activeCount} 名・オンライン ${filteredOnlineCount}/${onlineCount} 名`} />
              <div className="staff-filter-bar" aria-label="スタッフ絞り込み">
                <label>
                  <span>所属会社</span>
                  <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
                    <option value={ALL_FILTER}>すべての会社</option>
                    {companyOptions.map((company) => (
                      <option key={company} value={company}>{company}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>店舗</span>
                  <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
                    <option value={ALL_FILTER}>すべての店舗</option>
                    {storeOptions.map((store) => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>役職・区分</span>
                  <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}>
                    <option value={ALL_FILTER}>すべての役職・区分</option>
                    <optgroup label="スタッフ区分">
                      {Object.entries(staffCategoryLabels).map(([value, label]) => (
                        <option key={value} value={`category:${value}`}>{label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="権限">
                      {Object.entries(roleLabels).map(([value, label]) => (
                        <option key={value} value={`role:${value}`}>{label}</option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setCompanyFilter(ALL_FILTER);
                    setStoreFilter(ALL_FILTER);
                    setPositionFilter(ALL_FILTER);
                  }}
                >
                  条件をクリア
                </button>
              </div>
              <div className="management-list">
                {filteredStaff.length ? filteredStaff.map((member) => (
                  <article className="management-row staff-row" key={member.id}>
                    <div>
                      <div className="staff-row-heading">
                        <strong>{member.name}</strong>
                        <span className={`presence-pill ${getPresenceState(member.lastSeenAt).tone}`}>
                          {getPresenceState(member.lastSeenAt).label}
                        </span>
                      </div>
                      <p>
                        {[
                          `ID ${member.loginId}`,
                          roleLabels[member.role] ?? member.role,
                          staffCategoryLabels[member.staffCategory] ?? member.staffCategory
                        ].join(" / ")}
                      </p>
                      <small>
                        {member.status === "active" ? "有効" : "停止中"} ・ {payrollSubjectLabels[member.payrollSubject] ?? member.payrollSubject} ・ 閲覧: {getVisibleStores(member).length ? getVisibleStores(member).map((store) => store.name).join("、") : "全店舗"} ・ 勤務: {getWorkStores(member).length ? getWorkStores(member).map(formatWorkStoreSummary).join("、") : "未設定"} ・ {formatLastSeen(member.lastSeenAt)}
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
                )) : (
                  <p className="empty-state-text">条件に一致するスタッフがいません。</p>
                )}
              </div>
            </section>

            <section className="panel">
              <PanelTitle title="スタッフ追加" subtitle="ログインID、初期パスワード、店舗権限を設定" />
              {error ? <div className="login-error">{error}</div> : null}
              <form className="management-form staff-form" onSubmit={createStaff}>
                <StaffFormFields stores={stores} onNotice={showNotice} onError={setError} />
                <button className="primary-button" type="submit">追加</button>
              </form>
            </section>
          </section>
        )}
      </section>

      {editingStaff ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="staff-edit-title">
          <section className="edit-modal staff-edit-modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Staff</p>
                <h3 id="staff-edit-title">スタッフを編集</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => setEditingStaff(null)}>閉じる</button>
            </div>
            {error ? <div className="login-error">{error}</div> : null}
            <form className="management-form staff-form" onSubmit={updateStaff}>
              <StaffFormFields
                member={editingStaff}
                stores={stores}
                currentUserId={currentUserId}
                onHistoryChanged={reloadStaffKeepingEdit}
                onNotice={showNotice}
                onError={setError}
              />
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

function getMemberStores(member: StaffMember) {
  const storeMap = new Map<string, StoreOption>();
  for (const store of [...getVisibleStores(member), ...getWorkStores(member)]) {
    storeMap.set(store.id, store);
  }
  return Array.from(storeMap.values());
}

function formatWorkStoreSummary(store: WorkStoreOption) {
  const details = [
    store.employeeNumber ? `社員番号 ${store.employeeNumber}` : "",
    employeeTypeLabels[store.employeeType ?? ""] ?? ""
  ].filter(Boolean);
  return details.length ? `${store.name}（${details.join(" / ")}）` : store.name;
}

function StaffFormFields({
  member,
  stores,
  currentUserId,
  onHistoryChanged,
  onNotice,
  onError
}: {
  member?: StaffMember;
  stores: StoreOption[];
  currentUserId?: string;
  onHistoryChanged?: (employeeId: string) => Promise<void> | void;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const selectedVisibleStoreIds = new Set(member ? getVisibleStores(member).map((store) => store.id) : []);
  const workStoreById = new Map((member ? getWorkStores(member) : []).map((store) => [store.id, store]));
  const isSelf = Boolean(member && member.id === currentUserId);
  const [larkStatus, setLarkStatus] = useState("");
  const [activeTab, setActiveTab] = useState<"basic" | "payroll" | "other">("basic");
  const [selectedWorkStoreIdList, setSelectedWorkStoreIdList] = useState<string[]>(() => (
    member ? getWorkStores(member).map((store) => store.id) : []
  ));
  const selectedWorkStoreIds = useMemo(() => new Set(selectedWorkStoreIdList), [selectedWorkStoreIdList]);

  useEffect(() => {
    setSelectedWorkStoreIdList(member ? getWorkStores(member).map((store) => store.id) : []);
  }, [member]);

  function toggleWorkStore(storeId: string, checked: boolean) {
    setSelectedWorkStoreIdList((current) => {
      if (checked) return current.includes(storeId) ? current : [...current, storeId];
      return current.filter((id) => id !== storeId);
    });
  }

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

  function setNamedInputValue(form: HTMLFormElement, name: string, value: number | string | null | undefined) {
    const input = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (input) input.value = value === null || value === undefined ? "" : String(value);
  }

  function syncPayrollWageInputs(form: HTMLFormElement, storeId: string, employmentType: string) {
    const isMonthly = employmentType === "monthly";
    const hourlyInput = form.elements.namedItem(`hourlyWage:${storeId}`) as HTMLInputElement | null;
    const monthlyInput = form.elements.namedItem(`monthlySalary:${storeId}`) as HTMLInputElement | null;
    if (hourlyInput) {
      hourlyInput.disabled = isMonthly;
      if (isMonthly) hourlyInput.value = "";
    }
    if (monthlyInput) {
      monthlyInput.disabled = !isMonthly;
      if (!isMonthly) monthlyInput.value = "";
    }
  }

  function handlePayrollEmploymentTypeChange(event: FormEvent<HTMLSelectElement>, storeId: string) {
    const form = event.currentTarget.form;
    if (!form) return;
    syncPayrollWageInputs(form, storeId, event.currentTarget.value);
  }

  function setCheckedValue(form: HTMLFormElement, name: string, value: string, checked: boolean) {
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
    const input = inputs.find((candidate) => candidate.value === value);
    if (input) input.checked = checked;
  }

  function applyPayrollHistory(event: MouseEvent<HTMLButtonElement>, store: StoreOption, record: PayrollHistoryEntry) {
    const form = event.currentTarget.form;
    if (!form) return;

    setCheckedValue(form, "workStoreIds", store.id, true);
    setCheckedValue(form, "payrollEnabledStoreIds", store.id, record.payrollEnabled !== false);
    setNamedInputValue(form, `employmentType:${store.id}`, record.employmentType === "monthly" ? "monthly" : "hourly");
    setNamedInputValue(form, `hourlyWage:${store.id}`, record.hourlyWage ?? "");
    setNamedInputValue(form, `monthlySalary:${store.id}`, record.monthlySalary ?? "");
    syncPayrollWageInputs(form, store.id, record.employmentType === "monthly" ? "monthly" : "hourly");
    setNamedInputValue(form, `commuteAllowancePerWorkday:${store.id}`, record.commuteAllowancePerWorkday ?? 0);
    setNamedInputValue(form, `commuteAllowanceMonthlyCap:${store.id}`, record.commuteAllowanceMonthlyCap ?? "");
    setNamedInputValue(form, `wageValidFromMonth:${store.id}`, formatPayrollMonth(record.wageValidFrom ?? record.validFrom, store));
    setNamedInputValue(form, `commuteValidFromMonth:${store.id}`, formatPayrollMonth(record.commuteValidFrom ?? record.validFrom, store));
    setCheckedValue(form, "applySocialInsuranceStoreIds", store.id, Boolean(record.applySocialInsurance));
    setCheckedValue(form, "applyEmploymentInsuranceStoreIds", store.id, Boolean(record.applyEmploymentInsurance));
    setCheckedValue(form, "applyLaborInsuranceStoreIds", store.id, Boolean(record.applyLaborInsurance));
    setCheckedValue(form, "applyIncomeTaxStoreIds", store.id, Boolean(record.applyIncomeTax));
    setCheckedValue(form, "applyResidentTaxStoreIds", store.id, Boolean(record.applyResidentTax));
    setNamedInputValue(form, `residentTaxYear:${store.id}`, record.residentTaxYear ?? "");
    setNamedInputValue(form, `residentTaxJuneAmount:${store.id}`, record.residentTaxJuneAmount ?? "");
    setNamedInputValue(form, `residentTaxMonthlyAmount:${store.id}`, record.residentTaxMonthlyAmount ?? "");
    onNotice?.("給与変更履歴を入力欄に読み込みました。保存すると反映されます。");
  }

  async function deletePayrollHistory(record: PayrollHistoryEntry) {
    if (!member || !record.id) return;
    if (!window.confirm("この給与変更履歴を削除しますか？")) return;

    onError?.("");
    const response = await fetch(`/api/staff/${member.id}/payroll-history/${record.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      onError?.(body.error ?? "給与変更履歴を削除できませんでした。");
      return;
    }

    await onHistoryChanged?.(member.id);
    onNotice?.("給与変更履歴を削除しました。");
  }

  return (
    <>
      <div className="staff-form-tabs" role="tablist" aria-label="スタッフ情報">
        <button className={activeTab === "basic" ? "is-active" : ""} type="button" onClick={() => setActiveTab("basic")}>基本情報</button>
        <button className={activeTab === "payroll" ? "is-active" : ""} type="button" onClick={() => setActiveTab("payroll")}>勤務・給与情報</button>
        <button className={activeTab === "other" ? "is-active" : ""} type="button" onClick={() => setActiveTab("other")}>その他</button>
      </div>

      <section className={activeTab === "basic" ? "staff-form-pane is-active" : "staff-form-pane"}>
        <label>
          <span>氏名</span>
          <input name="name" defaultValue={member?.name ?? ""} placeholder="例: 山田 太郎" required />
        </label>
        <label>
          <span>フリガナ</span>
          <input name="nameKana" defaultValue={member?.nameKana ?? ""} placeholder="例: ヤマダ タロウ" />
        </label>
        <label>
          <span>性別</span>
          <select name="gender" defaultValue={member?.gender ?? "unspecified"}>
            <option value="unspecified">未設定</option>
            <option value="male">男性</option>
            <option value="female">女性</option>
            <option value="other">その他</option>
          </select>
        </label>
        <label>
          <span>生年月日</span>
          <input name="birthDate" type="date" defaultValue={toDateInputValue(member?.birthDate)} />
        </label>
        <label>
          <span>住所</span>
          <textarea name="address" defaultValue={member?.address ?? ""} placeholder="郵便番号・住所" />
        </label>
        <label>
          <span>外国人</span>
          <select name="isForeignNational" defaultValue={member?.isForeignNational ? "true" : "false"}>
            <option value="false">該当しない</option>
            <option value="true">該当する</option>
          </select>
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
            <option value="management">管理職</option>
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
        <div className="staff-payroll-guide">
          <strong>勤務店舗ごとに雇用情報と給与を設定</strong>
          <p>社員番号、入社日、退職情報、業務の種類、雇用区分は勤務先ごとの雇用関係として管理します。閲覧権限は「その他」タブで別に設定します。</p>
        </div>
        <input name="employmentType" type="hidden" value={member?.employmentType ?? "hourly"} readOnly />
        <input name="hourlyWage" type="hidden" value={String(member?.hourlyWage ?? "")} readOnly />
        <input name="monthlySalary" type="hidden" value={String(member?.monthlySalary ?? "")} readOnly />
        <input name="commuteAllowancePerWorkday" type="hidden" value={String(member?.commuteAllowancePerWorkday ?? 0)} readOnly />
        <input name="commuteAllowanceMonthlyCap" type="hidden" value={String(member?.commuteAllowanceMonthlyCap ?? "")} readOnly />
        <div className="staff-payroll-store-list">
          {stores.length ? stores.map((store) => {
            const setting = workStoreById.get(store.id);
            const defaultEmploymentType = setting?.employmentType ?? member?.employmentType ?? "hourly";
            const history = (setting?.payrollHistory ?? []).slice(0, 4);
            const isWorkStore = selectedWorkStoreIds.has(store.id);
            return (
              <article className={isWorkStore ? "staff-payroll-store-row" : "staff-payroll-store-row is-inactive"} key={store.id}>
                <label className="staff-payroll-store-toggle">
                  <input
                    type="checkbox"
                    name="workStoreIds"
                    value={store.id}
                    checked={isWorkStore}
                    onChange={(event) => toggleWorkStore(store.id, event.currentTarget.checked)}
                  />
                  <span>
                    <strong>{store.name}</strong>
                    <small>{store.companyName ?? "会社未設定"}</small>
                  </span>
                </label>
                {!isWorkStore ? (
                  <div className="staff-payroll-store-placeholder">
                    <strong>勤務店舗ではありません</strong>
                    <small>チェックすると、この店舗の給与設定を入力できます。</small>
                  </div>
                ) : (
                  <>
                <fieldset className="staff-employment-store-fields">
                  <span>雇用基本情報</span>
                  <label>
                    <span>社員番号</span>
                    <input name={`employeeNumber:${store.id}`} defaultValue={setting?.employeeNumber ?? ""} placeholder="例: B202605001" />
                  </label>
                  <label>
                    <span>雇用区分</span>
                    <select name={`employeeType:${store.id}`} defaultValue={setting?.employeeType ?? "part_time"}>
                      <option value="part_time">アルバイト</option>
                      <option value="full_time">正社員</option>
                    </select>
                  </label>
                  <label>
                    <span>従事する業務の種類</span>
                    <input name={`businessType:${store.id}`} defaultValue={setting?.businessType ?? ""} placeholder="例: 接客、調理、店舗管理" />
                  </label>
                  <details className="staff-employment-more">
                    <summary>入退社情報</summary>
                    <div>
                      <label>
                        <span>入社日</span>
                        <input name={`hireDate:${store.id}`} type="date" defaultValue={toDateInputValue(setting?.hireDate)} />
                      </label>
                      <label>
                        <span>退職日</span>
                        <input name={`resignationDate:${store.id}`} type="date" defaultValue={toDateInputValue(setting?.resignationDate)} />
                      </label>
                      <label className="staff-employment-wide">
                        <span>退職理由</span>
                        <textarea name={`resignationReason:${store.id}`} defaultValue={setting?.resignationReason ?? ""} placeholder="退職時のみ入力" />
                      </label>
                    </div>
                  </details>
                </fieldset>
                <fieldset className="staff-payroll-wage-fields">
                  <span>給与情報</span>
                  <label>
                    <span>給与計算に含める</span>
                    <span className="staff-payroll-check">
                      <input type="checkbox" name="payrollEnabledStoreIds" value={store.id} defaultChecked={selectedWorkStoreIds.has(store.id) && setting?.payrollEnabled !== false} />
                      計算する
                    </span>
                  </label>
                  <label>
                    <span>給与形態</span>
                    <select
                      name={`employmentType:${store.id}`}
                      defaultValue={defaultEmploymentType === "monthly" ? "monthly" : "hourly"}
                      onChange={(event) => handlePayrollEmploymentTypeChange(event, store.id)}
                    >
                      <option value="hourly">時給</option>
                      <option value="monthly">月給</option>
                    </select>
                  </label>
                  <label>
                    <span>時給</span>
                    <input name={`hourlyWage:${store.id}`} type="number" min="0" step="1" defaultValue={defaultEmploymentType === "monthly" ? "" : setting?.hourlyWage ?? member?.hourlyWage ?? ""} placeholder="例: 1200" disabled={defaultEmploymentType === "monthly"} />
                  </label>
                  <label>
                    <span>月給</span>
                    <input name={`monthlySalary:${store.id}`} type="number" min="0" step="1" defaultValue={defaultEmploymentType === "monthly" ? setting?.monthlySalary ?? member?.monthlySalary ?? "" : ""} placeholder="月給のみ" disabled={defaultEmploymentType !== "monthly"} />
                  </label>
                  <label>
                    <span>交通費 / 勤務日</span>
                    <input name={`commuteAllowancePerWorkday:${store.id}`} type="number" min="0" step="1" defaultValue={setting?.commuteAllowancePerWorkday ?? member?.commuteAllowancePerWorkday ?? 0} />
                  </label>
                  <label>
                    <span>交通費月上限</span>
                    <input name={`commuteAllowanceMonthlyCap:${store.id}`} type="number" min="0" step="1" defaultValue={setting?.commuteAllowanceMonthlyCap ?? member?.commuteAllowanceMonthlyCap ?? ""} placeholder="任意" />
                  </label>
                  <label>
                    <span>賃金適用月度</span>
                    <input name={`wageValidFromMonth:${store.id}`} type="month" defaultValue={formatPayrollMonth(history[0]?.wageValidFrom ?? history[0]?.validFrom, store) || toDateInputValue(new Date().toISOString()).slice(0, 7)} />
                  </label>
                  <label>
                    <span>交通費適用月度</span>
                    <input name={`commuteValidFromMonth:${store.id}`} type="month" defaultValue={formatPayrollMonth(history[0]?.commuteValidFrom ?? history[0]?.validFrom, store) || toDateInputValue(new Date().toISOString()).slice(0, 7)} />
                  </label>
                </fieldset>
                <fieldset className="staff-payroll-deductions">
                  <span>控除・徴収の適用</span>
                  <section className="staff-deduction-section">
                    <strong>社会保険</strong>
                    <div>
                      <label className="staff-deduction-check">
                        <span>適用</span>
                        <span className="staff-payroll-check">
                          <input type="checkbox" name="applySocialInsuranceStoreIds" value={store.id} defaultChecked={Boolean(setting?.applySocialInsurance)} />
                          適用する
                        </span>
                      </label>
                      <label className="staff-tax-select">
                        <span>標準報酬月額</span>
                        <input name={`socialInsuranceStandardMonthlyAmount:${store.id}`} type="number" min="0" step="1000" defaultValue={setting?.socialInsuranceStandardMonthlyAmount ?? ""} placeholder="例: 220000" />
                      </label>
                      <label className="staff-tax-select">
                        <span>控除開始月</span>
                        <input name={`socialInsuranceDeductionFromMonth:${store.id}`} type="month" defaultValue={String(setting?.socialInsuranceDeductionFrom ?? "").slice(0, 7)} />
                      </label>
                    </div>
                  </section>
                  <section className="staff-deduction-section">
                    <strong>雇用保険</strong>
                    <div>
                      <label className="staff-deduction-check">
                        <span>適用</span>
                        <span className="staff-payroll-check">
                          <input type="checkbox" name="applyEmploymentInsuranceStoreIds" value={store.id} defaultChecked={Boolean(setting?.applyEmploymentInsurance)} />
                          適用する
                        </span>
                      </label>
                      <label className="staff-tax-select">
                        <span>控除開始月</span>
                        <input name={`employmentInsuranceDeductionFromMonth:${store.id}`} type="month" defaultValue={String(setting?.employmentInsuranceDeductionFrom ?? "").slice(0, 7)} />
                      </label>
                    </div>
                  </section>
                  <section className="staff-deduction-section">
                    <strong>労働保険</strong>
                    <div>
                      <label className="staff-deduction-check">
                        <span>適用</span>
                        <span className="staff-payroll-check">
                          <input type="checkbox" name="applyLaborInsuranceStoreIds" value={store.id} defaultChecked={Boolean(setting?.applyLaborInsurance)} />
                          適用する
                        </span>
                      </label>
                    </div>
                  </section>
                  <section className="staff-deduction-section">
                    <strong>源泉所得税</strong>
                    <div>
                      <label className="staff-deduction-check">
                        <span>適用</span>
                        <span className="staff-payroll-check">
                          <input type="checkbox" name="applyIncomeTaxStoreIds" value={store.id} defaultChecked={Boolean(setting?.applyIncomeTax)} />
                          適用する
                        </span>
                      </label>
                      <label className="staff-tax-select">
                        <span>源泉税区分</span>
                        <select name={`incomeTaxCategory:${store.id}`} defaultValue={setting?.incomeTaxCategory ?? "none"}>
                          <option value="none">未設定</option>
                          <option value="kou">甲</option>
                          <option value="otsu">乙</option>
                        </select>
                      </label>
                      <label className="staff-tax-select">
                        <span>扶養人数</span>
                        <select name={`dependentCount:${store.id}`} defaultValue={String(setting?.dependentCount ?? 0)}>
                          {Array.from({ length: 8 }, (_, index) => (
                            <option value={index} key={index}>{index}人</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </section>
                  <section className="staff-deduction-section">
                    <strong>住民税</strong>
                    <div>
                      <label className="staff-deduction-check">
                        <span>適用</span>
                        <span className="staff-payroll-check">
                          <input type="checkbox" name="applyResidentTaxStoreIds" value={store.id} defaultChecked={Boolean(setting?.applyResidentTax)} />
                          適用する
                        </span>
                      </label>
                      <label className="staff-tax-select">
                        <span>対象年度</span>
                        <input name={`residentTaxYear:${store.id}`} type="number" min="1900" max="2999" step="1" defaultValue={setting?.residentTaxYear ?? ""} placeholder="例: 2026" />
                      </label>
                      <label className="staff-tax-select">
                        <span>6月分</span>
                        <input name={`residentTaxJuneAmount:${store.id}`} type="number" min="0" step="1" defaultValue={setting?.residentTaxJuneAmount ?? ""} placeholder="例: 8500" />
                      </label>
                      <label className="staff-tax-select">
                        <span>7月以降分</span>
                        <input name={`residentTaxMonthlyAmount:${store.id}`} type="number" min="0" step="1" defaultValue={setting?.residentTaxMonthlyAmount ?? ""} placeholder="例: 8200" />
                      </label>
                    </div>
                  </section>
                </fieldset>
                <div className="staff-payroll-history">
                  <span>給与変更履歴</span>
                  {history.length ? history.map((record, index) => (
                    <div className="staff-payroll-history-row" key={`${store.id}-${record.id ?? record.validFrom ?? index}`}>
                      <small>
                        賃金 {formatPayrollMonthLabel(record.wageValidFrom ?? record.validFrom, store)} {record.employmentType === "monthly" ? `月給 ${formatPayrollAmount(record.monthlySalary)}` : `時給 ${formatPayrollAmount(record.hourlyWage)}`} / 交通費 {formatPayrollMonthLabel(record.commuteValidFrom ?? record.validFrom, store)} {formatPayrollAmount(record.commuteAllowancePerWorkday)} / 源泉 {record.applyIncomeTax ? `${record.incomeTaxCategory === "otsu" ? "乙" : record.incomeTaxCategory === "kou" ? "甲" : "未設定"} ${record.dependentCount ?? 0}人` : "なし"} / 住民税 {record.applyResidentTax ? `${record.residentTaxYear ?? "-"}年度 6月${formatPayrollAmount(record.residentTaxJuneAmount)} 7月以降${formatPayrollAmount(record.residentTaxMonthlyAmount)}` : "なし"}
                      </small>
                      <span className="staff-payroll-history-actions">
                        <button className="secondary-button" type="button" onClick={(event) => applyPayrollHistory(event, store, record)}>
                          編集
                        </button>
                        <button className="danger-button" type="button" disabled={!record.id} onClick={() => void deletePayrollHistory(record)}>
                          削除
                        </button>
                      </span>
                    </div>
                  )) : (
                    <small>まだ履歴がありません。保存するとこの設定が履歴に残ります。</small>
                  )}
                </div>
                  </>
                )}
              </article>
            );
          }) : <p className="empty-state-text">店舗データがありません。</p>}
        </div>
      </section>

      <section className={activeTab === "other" ? "staff-form-pane is-active" : "staff-form-pane"}>
        <fieldset className="checkbox-group staff-store-scope">
          <span>閲覧可能店舗（権限）</span>
          <small>ここは閲覧・管理できる店舗の範囲です。実際に勤務して給与計算する店舗は「給与情報」タブで設定します。</small>
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
