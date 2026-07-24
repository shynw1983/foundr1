"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Save, Search, Settings, Store, Truck, Upload, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { defaultStoreModuleSettings, storeOrderAlertSoundOptions, type StoreModuleSettings, type StoreOrderAlertSound } from "../../../lib/module-setting-defaults";
import { normalizeDecimalInput, normalizeIntegerInput } from "../../../lib/number-input";
import {
  defaultNavigationMenuSettings,
  type NavigationMenuSettings
} from "../../../lib/navigation-setting-defaults";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { canonicalNavItems, navModules, OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";
import { setCachedNavigationSettings } from "../components/navigationSettingsStore";
import { playStoreOrderAlertSound } from "../../../lib/store-order-alert-sounds";

const employmentInsuranceManualRows = [
  { businessType: "general", label: "一般の事業", employeeRate: "5", employerRate: "8.5", benefitRate: "5", twoProjectsRate: "3.5", totalRate: "13.5" },
  { businessType: "agriculture_sake", label: "農林水産・清酒製造の事業", employeeRate: "6", employerRate: "9.5", benefitRate: "6", twoProjectsRate: "3.5", totalRate: "15.5" },
  { businessType: "construction", label: "建設の事業", employeeRate: "6", employerRate: "10.5", benefitRate: "6", twoProjectsRate: "4.5", totalRate: "16.5" }
];

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
  { label: "システム設定", href: "/os/settings", icon: Settings }
];

type WithholdingTaxTable = {
  id: string;
  taxYear: number;
  tableType: string;
  title: string;
  sourceFileName: string | null;
  effectiveFrom: string;
  isActive: boolean;
  createdAt: string;
  rowCount: number;
};

type SocialInsuranceTable = {
  id: string;
  fiscalYear: number;
  title: string;
  sourceFileName: string | null;
  effectiveFrom: string;
  rowCount: number;
};

type EmploymentInsuranceTable = {
  id: string;
  fiscalYear: number;
  title: string;
  sourceFileName: string | null;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
  createdAt: string;
  rowCount: number;
  rows?: Array<{
    businessType: string;
    label: string;
    employeeRate: number;
    employerRate: number | null;
    benefitRate: number | null;
    twoProjectsRate: number | null;
    totalRate: number | null;
  }>;
};

type PayrollStatutoryAlert = {
  key: string;
  level: "critical" | "warning";
  title: string;
  message: string;
  actionLabel: string;
  dueLabel: string;
};

type PayrollAllowanceRule = {
  id: string;
  name: string;
  ruleType: "fixed_monthly" | "one_person_busy_hourly" | "time_performance_multiplier" | "performance_tier_per_shift";
  storeId: string | null;
  storeName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  amount: number;
  baseMultiplier: number | null;
  triggerMultiplier: number | null;
  salesThreshold: number | null;
  orderThreshold: number | null;
  sourcePlatform: string;
  tiers: Array<{ salesThreshold: number; amount: number }>;
  includeInPremiumBase: boolean;
  validFrom: string;
  validTo: string | null;
  isEnabled: boolean;
  windows: Array<{ weekday: number; startTime: string; endTime: string }>;
};

type PayrollAllowanceOption = {
  id: string;
  name: string;
};

type RolePermissionDefinition = {
  key: string;
  label: string;
  description: string;
  category: string;
};

type RolePermissionState = {
  role: string;
  permissions: Array<{
    key: string;
    enabled: boolean;
    locked: boolean;
  }>;
};

const roleLabels: Record<string, string> = {
  owner: "本部オーナー",
  manager: "本部マネージャー",
  store_owner: "加盟店オーナー",
  store_manager: "店長",
  staff: "店舗スタッフ",
  store_terminal: "店舗Pad"
};

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
type SettingsSection = "payroll" | "store" | "navigation" | "permissions";

const settingsSections: Array<{ key: SettingsSection; label: string; description: string }> = [
  { key: "payroll", label: "給与設定", description: "手当・税表" },
  { key: "store", label: "Store設定", description: "現場画面" },
  { key: "navigation", label: "メニュー表示", description: "Beta表示" },
  { key: "permissions", label: "権限", description: "ユーザーグループ" }
];

function getInitialSettingsSection(): SettingsSection {
  if (typeof window === "undefined") return "payroll";
  const section = new URLSearchParams(window.location.search).get("section");
  return settingsSections.some((item) => item.key === section) ? section as SettingsSection : "payroll";
}

export default function OsSettingsPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const alertPreviewAudioContextRef = useRef<AudioContext | null>(null);
  const [settings, setSettings] = useState<StoreModuleSettings>(defaultStoreModuleSettings);
  const [navigationSettings, setNavigationSettings] = useState<NavigationMenuSettings>(defaultNavigationMenuSettings);
  const [taxTables, setTaxTables] = useState<WithholdingTaxTable[]>([]);
  const [socialInsuranceTables, setSocialInsuranceTables] = useState<SocialInsuranceTable[]>([]);
  const [employmentInsuranceTables, setEmploymentInsuranceTables] = useState<EmploymentInsuranceTable[]>([]);
  const [payrollAlerts, setPayrollAlerts] = useState<PayrollStatutoryAlert[]>([]);
  const [payrollAllowanceRules, setPayrollAllowanceRules] = useState<PayrollAllowanceRule[]>([]);
  const [payrollAllowanceStores, setPayrollAllowanceStores] = useState<PayrollAllowanceOption[]>([]);
  const [payrollAllowanceEmployees, setPayrollAllowanceEmployees] = useState<PayrollAllowanceOption[]>([]);
  const [rolePermissionDefinitions, setRolePermissionDefinitions] = useState<RolePermissionDefinition[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermissionState[]>([]);
  const [canEditRolePermissions, setCanEditRolePermissions] = useState(false);
  const [taxFile, setTaxFile] = useState<File | null>(null);
  const [socialInsuranceFile, setSocialInsuranceFile] = useState<File | null>(null);
  const [employmentInsuranceFile, setEmploymentInsuranceFile] = useState<File | null>(null);
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [socialInsuranceYear, setSocialInsuranceYear] = useState(String(new Date().getFullYear()));
  const [employmentInsuranceYear, setEmploymentInsuranceYear] = useState(String(new Date().getFullYear()));
  const [employmentInsuranceEffectiveFrom, setEmploymentInsuranceEffectiveFrom] = useState(`${new Date().getFullYear()}-04-01`);
  const [employmentInsuranceEffectiveTo, setEmploymentInsuranceEffectiveTo] = useState(`${new Date().getFullYear() + 1}-03-31`);
  const [employmentInsuranceBusinessType, setEmploymentInsuranceBusinessType] = useState("general");
  const [allowanceName, setAllowanceName] = useState("");
  const [allowanceRuleType, setAllowanceRuleType] = useState<PayrollAllowanceRule["ruleType"]>("time_performance_multiplier");
  const [allowanceStoreId, setAllowanceStoreId] = useState("");
  const [allowanceEmployeeId, setAllowanceEmployeeId] = useState("");
  const [allowanceAmount, setAllowanceAmount] = useState("");
  const [allowanceValidFrom, setAllowanceValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [allowanceValidTo, setAllowanceValidTo] = useState("");
  const [allowanceStartTime, setAllowanceStartTime] = useState("20:00");
  const [allowanceEndTime, setAllowanceEndTime] = useState("22:00");
  const [allowanceWeekdays, setAllowanceWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [allowanceBasePercent, setAllowanceBasePercent] = useState("25");
  const [allowanceTriggerPercent, setAllowanceTriggerPercent] = useState("50");
  const [allowanceSalesThreshold, setAllowanceSalesThreshold] = useState("50000");
  const [allowanceOrderThreshold, setAllowanceOrderThreshold] = useState("15");
  const [allowanceTiers, setAllowanceTiers] = useState([
    { salesThreshold: "25000", amount: "1000" },
    { salesThreshold: "30000", amount: "1500" },
    { salesThreshold: "40000", amount: "2000" }
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingNavigationSettings, setSavingNavigationSettings] = useState(false);
  const [uploadingTaxTable, setUploadingTaxTable] = useState(false);
  const [uploadingSocialInsurance, setUploadingSocialInsurance] = useState(false);
  const [uploadingEmploymentInsurance, setUploadingEmploymentInsurance] = useState(false);
  const [savingPayrollAllowance, setSavingPayrollAllowance] = useState(false);
  const [savingRolePermissions, setSavingRolePermissions] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>(getInitialSettingsSection);
  const groupedRolePermissionDefinitions = useMemo(() => {
    const groups = new Map<string, RolePermissionDefinition[]>();
    for (const definition of rolePermissionDefinitions) {
      groups.set(definition.category, [...(groups.get(definition.category) ?? []), definition]);
    }
    return Array.from(groups.entries()).map(([category, definitions]) => ({ category, definitions }));
  }, [rolePermissionDefinitions]);

  async function previewStoreOrderAlertSound(sound: StoreOrderAlertSound) {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      showNotice("この端末では通知音を再生できません。", "info");
      return;
    }
    if (!alertPreviewAudioContextRef.current) {
      alertPreviewAudioContextRef.current = new AudioContextClass();
    }
    if (alertPreviewAudioContextRef.current.state === "suspended") {
      await alertPreviewAudioContextRef.current.resume();
    }
    playStoreOrderAlertSound(alertPreviewAudioContextRef.current, sound);
  }

  useEffect(() => {
    async function loadSettings() {
      const [settingsResponse, navigationResponse, taxResponse, socialInsuranceResponse, employmentInsuranceResponse, alertResponse, allowanceResponse, rolePermissionsResponse] = await Promise.all([
        fetch("/api/settings?module=store", { cache: "no-store" }),
        fetch("/api/settings?module=navigation", { cache: "no-store" }),
        fetch("/api/settings/withholding-tax", { cache: "no-store" }),
        fetch("/api/settings/social-insurance", { cache: "no-store" }),
        fetch("/api/settings/employment-insurance", { cache: "no-store" }),
        fetch("/api/settings/payroll-statutory-alerts", { cache: "no-store" }),
        fetch("/api/settings/payroll-allowances", { cache: "no-store" }),
        fetch("/api/settings/role-permissions", { cache: "no-store" })
      ]);
      if (settingsResponse.ok) {
        const body = await settingsResponse.json() as { settings?: StoreModuleSettings };
        if (body.settings) setSettings(body.settings);
      }
      if (navigationResponse.ok) {
        const body = await navigationResponse.json() as { settings?: NavigationMenuSettings };
        if (body.settings) setNavigationSettings(body.settings);
      }
      if (taxResponse.ok) {
        const body = await taxResponse.json() as { tables?: WithholdingTaxTable[] };
        setTaxTables(body.tables ?? []);
      }
      if (socialInsuranceResponse.ok) {
        const body = await socialInsuranceResponse.json() as { tables?: SocialInsuranceTable[] };
        setSocialInsuranceTables(body.tables ?? []);
      }
      if (employmentInsuranceResponse.ok) {
        const body = await employmentInsuranceResponse.json() as { tables?: EmploymentInsuranceTable[] };
        setEmploymentInsuranceTables(body.tables ?? []);
      }
      if (alertResponse.ok) {
        const body = await alertResponse.json() as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
        if (body.canView) setPayrollAlerts(body.alerts ?? []);
      }
      if (allowanceResponse.ok) {
        const body = await allowanceResponse.json() as { rules?: PayrollAllowanceRule[]; stores?: PayrollAllowanceOption[]; employees?: PayrollAllowanceOption[] };
        setPayrollAllowanceRules(body.rules ?? []);
        setPayrollAllowanceStores(body.stores ?? []);
        setPayrollAllowanceEmployees(body.employees ?? []);
      }
      if (rolePermissionsResponse.ok) {
        const body = await rolePermissionsResponse.json() as {
          definitions?: RolePermissionDefinition[];
          rolePermissions?: RolePermissionState[];
          canEdit?: boolean;
        };
        setRolePermissionDefinitions(body.definitions ?? []);
        setRolePermissions(body.rolePermissions ?? []);
        setCanEditRolePermissions(body.canEdit === true);
      }
      setLoading(false);
    }
    void loadSettings();
  }, []);

  async function saveSettings() {
    setSaving(true);
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleKey: "store", settings })
    });
    setSaving(false);
    if (!response.ok) {
      showNotice("設定を保存できませんでした。", "info");
      return;
    }
    const body = await response.json() as { settings?: StoreModuleSettings };
    if (body.settings) setSettings(body.settings);
    showNotice("設定を保存しました。");
  }

  function toggleNavigationBeta(path: string, checked: boolean) {
    setNavigationSettings((current) => {
      const nextPaths = new Set(current.betaNavPaths);
      if (checked) {
        nextPaths.add(path);
      } else {
        nextPaths.delete(path);
      }
      return { ...current, betaNavPaths: Array.from(nextPaths) };
    });
  }

  async function saveNavigationSettings() {
    setSavingNavigationSettings(true);
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleKey: "navigation", settings: navigationSettings })
    });
    setSavingNavigationSettings(false);
    const body = await response.json().catch(() => ({})) as { settings?: NavigationMenuSettings; error?: string };
    if (!response.ok) {
      showNotice(body.error ?? "メニュー Beta 表示を保存できませんでした。", "info");
      return;
    }
    if (body.settings) {
      setNavigationSettings(body.settings);
      setCachedNavigationSettings(body.settings);
    }
    showNotice("メニュー Beta 表示を保存しました。");
  }

  async function reloadPayrollAllowances() {
    const response = await fetch("/api/settings/payroll-allowances", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { rules?: PayrollAllowanceRule[]; stores?: PayrollAllowanceOption[]; employees?: PayrollAllowanceOption[] };
    setPayrollAllowanceRules(body.rules ?? []);
    setPayrollAllowanceStores(body.stores ?? []);
    setPayrollAllowanceEmployees(body.employees ?? []);
  }

  function toggleAllowanceWeekday(weekday: number, checked: boolean) {
    setAllowanceWeekdays((current) => {
      const next = new Set(current);
      if (checked) next.add(weekday);
      else next.delete(weekday);
      return Array.from(next).sort((left, right) => left - right);
    });
  }

  async function createPayrollAllowanceRule() {
    setSavingPayrollAllowance(true);
    const response = await fetch("/api/settings/payroll-allowances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        name: allowanceName,
        ruleType: allowanceRuleType,
        storeId: allowanceStoreId || null,
        employeeId: allowanceEmployeeId || null,
        amount: allowanceAmount,
        includeInPremiumBase: true,
        validFrom: allowanceValidFrom,
        validTo: allowanceValidTo || null,
        weekdays: allowanceWeekdays,
        startTime: allowanceStartTime,
        endTime: allowanceEndTime,
        baseMultiplier: 1 + (Number(allowanceBasePercent) || 0) / 100,
        triggerMultiplier: 1 + (Number(allowanceTriggerPercent) || 0) / 100,
        salesThreshold: allowanceSalesThreshold,
        orderThreshold: allowanceOrderThreshold,
        sourcePlatform: "uber_eats",
        tiers: allowanceTiers
      })
    });
    setSavingPayrollAllowance(false);
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      showNotice(body.error ?? "手当・加給ルールを保存できませんでした。", "info");
      return;
    }
    setAllowanceName("");
    setAllowanceAmount("");
    await reloadPayrollAllowances();
    showNotice("手当・加給ルールを保存しました。");
  }

  async function disablePayrollAllowanceRule(id: string) {
    const response = await fetch("/api/settings/payroll-allowances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable", id })
    });
    if (!response.ok) {
      showNotice("手当・加給ルールを停止できませんでした。", "info");
      return;
    }
    await reloadPayrollAllowances();
    showNotice("手当・加給ルールを停止しました。");
  }

  function toggleRolePermission(role: string, permissionKey: string, checked: boolean) {
    setRolePermissions((current) => current.map((roleState) => {
      if (roleState.role !== role) return roleState;
      return {
        ...roleState,
        permissions: roleState.permissions.map((permission) => (
          permission.key === permissionKey && !permission.locked ? { ...permission, enabled: checked } : permission
        ))
      };
    }));
  }

  async function saveRolePermissions() {
    setSavingRolePermissions(true);
    const response = await fetch("/api/settings/role-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rolePermissions: rolePermissions.map((roleState) => ({
          role: roleState.role,
          permissions: roleState.permissions.filter((permission) => permission.enabled).map((permission) => permission.key)
        }))
      })
    });
    setSavingRolePermissions(false);

    const body = await response.json().catch(() => ({})) as { rolePermissions?: RolePermissionState[]; error?: string };
    if (!response.ok) {
      showNotice(body.error ?? "ユーザーグループ権限を保存できませんでした。", "info");
      return;
    }
    setRolePermissions(body.rolePermissions ?? rolePermissions);
    showNotice("ユーザーグループ権限を保存しました。");
  }

  async function fileToBase64(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks: string[] = [];
    const chunkSize = 8192;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
    }
    return window.btoa(chunks.join(""));
  }

  function updateEmploymentInsuranceYear(nextYear: string) {
    setEmploymentInsuranceYear(nextYear);
    const year = Number(nextYear);
    if (Number.isFinite(year) && year >= 2020 && year <= 2100) {
      setEmploymentInsuranceEffectiveFrom(`${Math.round(year)}-04-01`);
      setEmploymentInsuranceEffectiveTo(`${Math.round(year) + 1}-03-31`);
    }
  }

  function ratePermille(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value * 1000);
  }

  async function uploadWithholdingTaxTable() {
    if (!taxFile) {
      showNotice("源泉税表ファイルを選択してください。", "info");
      return;
    }
    setUploadingTaxTable(true);
    const fileBase64 = await fileToBase64(taxFile);
    const response = await fetch("/api/settings/withholding-tax", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: taxFile.name, fileBase64, taxYear })
    });
    setUploadingTaxTable(false);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(String(body.error ?? "源泉税表を取り込めませんでした。"), "info");
      return;
    }
    setTaxFile(null);
    const taxResponse = await fetch("/api/settings/withholding-tax", { cache: "no-store" });
    if (taxResponse.ok) {
      const taxBody = await taxResponse.json() as { tables?: WithholdingTaxTable[] };
      setTaxTables(taxBody.tables ?? []);
    }
    showNotice(`源泉税表を取り込みました。${body.rowCount ?? 0}行`);
  }

  async function uploadSocialInsuranceTable() {
    if (!socialInsuranceFile) {
      showNotice("社会保険料表ファイルを選択してください。", "info");
      return;
    }
    setUploadingSocialInsurance(true);
    const fileBase64 = await fileToBase64(socialInsuranceFile);
    const response = await fetch("/api/settings/social-insurance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: socialInsuranceFile.name, fileBase64, fiscalYear: socialInsuranceYear })
    });
    setUploadingSocialInsurance(false);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(String(body.error ?? "社会保険料表を取り込めませんでした。"), "info");
      return;
    }
    setSocialInsuranceFile(null);
    const listResponse = await fetch("/api/settings/social-insurance", { cache: "no-store" });
    if (listResponse.ok) {
      const listBody = await listResponse.json() as { tables?: SocialInsuranceTable[] };
      setSocialInsuranceTables(listBody.tables ?? []);
    }
    showNotice(`社会保険料表を取り込みました。${body.rowCount ?? 0}行`);
  }

  async function uploadEmploymentInsuranceTable() {
    if (!employmentInsuranceFile) {
      showNotice("雇用保険料率ファイルを選択してください。", "info");
      return;
    }
    setUploadingEmploymentInsurance(true);
    const fileBase64 = await fileToBase64(employmentInsuranceFile);
    let response = await fetch("/api/settings/employment-insurance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: employmentInsuranceFile.name, fileBase64, fiscalYear: employmentInsuranceYear })
    });
    let body = await response.json().catch(() => ({}));
    if (!response.ok && ["2025", "2026"].includes(String(employmentInsuranceYear).trim())) {
      response = await fetch("/api/settings/employment-insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: employmentInsuranceFile.name, fiscalYear: employmentInsuranceYear })
      });
      body = await response.json().catch(() => ({}));
    }
    setUploadingEmploymentInsurance(false);
    if (!response.ok) {
      showNotice(`${response.status}: ${String(body.error ?? "雇用保険料率を取り込めませんでした。")}`, "info");
      return;
    }
    setEmploymentInsuranceFile(null);
    const listResponse = await fetch("/api/settings/employment-insurance", { cache: "no-store" });
    if (listResponse.ok) {
      const listBody = await listResponse.json() as { tables?: EmploymentInsuranceTable[] };
      setEmploymentInsuranceTables(listBody.tables ?? []);
    }
    showNotice(`雇用保険料率を取り込みました。${body.rowCount ?? 0}行`);
  }

  async function saveManualEmploymentInsuranceTable() {
    setUploadingEmploymentInsurance(true);
    const selectedRows = employmentInsuranceManualRows.filter((row) => row.businessType === employmentInsuranceBusinessType);
    const manualRows = selectedRows.map((row) => ({
      businessType: row.businessType,
      employeeRate: (document.querySelector<HTMLInputElement>(`input[name="employmentManualEmployeeRate:${row.businessType}"]`)?.value ?? ""),
      employerRate: (document.querySelector<HTMLInputElement>(`input[name="employmentManualEmployerRate:${row.businessType}"]`)?.value ?? ""),
      benefitRate: (document.querySelector<HTMLInputElement>(`input[name="employmentManualBenefitRate:${row.businessType}"]`)?.value ?? ""),
      twoProjectsRate: (document.querySelector<HTMLInputElement>(`input[name="employmentManualTwoProjectsRate:${row.businessType}"]`)?.value ?? ""),
      totalRate: (document.querySelector<HTMLInputElement>(`input[name="employmentManualTotalRate:${row.businessType}"]`)?.value ?? "")
    }));
    const response = await fetch("/api/settings/employment-insurance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "manual",
        fiscalYear: employmentInsuranceYear,
        effectiveFrom: employmentInsuranceEffectiveFrom,
        effectiveTo: employmentInsuranceEffectiveTo,
        manualRows
      })
    });
    setUploadingEmploymentInsurance(false);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(`${response.status}: ${String(body.error ?? "雇用保険料率を保存できませんでした。")}`, "info");
      return;
    }
    const listResponse = await fetch("/api/settings/employment-insurance", { cache: "no-store" });
    if (listResponse.ok) {
      const listBody = await listResponse.json() as { tables?: EmploymentInsuranceTable[] };
      setEmploymentInsuranceTables(listBody.tables ?? []);
    }
    showNotice(`雇用保険料率を保存しました。${body.rowCount ?? 0}行`);
  }

  const navigationItemByHref = new Map(canonicalNavItems.map((item) => [item.href, item]));
  const betaNavPathSet = new Set(navigationSettings.betaNavPaths);
  function selectSettingsSection(section: SettingsSection) {
    setActiveSection(section);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>システム設定</h1>
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
            <p className="eyebrow">Configuration</p>
            <h2>システム設定</h2>
            <span className="source-indicator">{loading ? "読み込み中" : "設定読み込み済み"}</span>
          </div>
          <button className="primary-button" type="button" disabled={saving} onClick={() => void saveSettings()}>
            <Save size={16} />
            {saving ? "保存中" : "設定を保存"}
          </button>
        </header>

        <section className="settings-section-tabs" aria-label="設定カテゴリ">
          {settingsSections.map((section) => (
            <button
              className={activeSection === section.key ? "is-active" : ""}
              type="button"
              onClick={() => selectSettingsSection(section.key)}
              key={section.key}
            >
              <strong>{section.label}</strong>
              <span>{section.description}</span>
            </button>
          ))}
        </section>

        <section className="settings-grid">
          {activeSection === "permissions" ? (
          <section className="panel settings-role-permissions-panel">
            <div className="panel-title">
              <div>
                <h3>ユーザーグループ権限</h3>
                <p>各ユーザーグループが表示できる OS モジュールと、スタッフ管理の操作権限を設定します。</p>
              </div>
              {canEditRolePermissions ? (
                <button className="secondary-button" type="button" disabled={savingRolePermissions} onClick={() => void saveRolePermissions()}>
                  <Save size={16} />
                  {savingRolePermissions ? "保存中" : "権限を保存"}
                </button>
              ) : null}
            </div>
            <div className="role-permission-table-wrap">
              <table className="role-permission-table">
                <thead>
                  <tr>
                    <th>権限項目</th>
                    {rolePermissions.map((roleState) => (
                      <th key={roleState.role}>{roleLabels[roleState.role] ?? roleState.role}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupedRolePermissionDefinitions.map((group) => (
                    <Fragment key={group.category}>
                      <tr className="role-permission-group-row">
                        <th colSpan={rolePermissions.length + 1}>{group.category}</th>
                      </tr>
                      {group.definitions.map((definition) => (
                        <tr key={definition.key}>
                          <th>
                            <strong>{definition.label}</strong>
                            <small>{definition.description}</small>
                          </th>
                          {rolePermissions.map((roleState) => {
                            const permission = roleState.permissions.find((candidate) => candidate.key === definition.key);
                            return (
                              <td key={`${roleState.role}:${definition.key}`}>
                                <label className="role-permission-check" aria-label={`${roleLabels[roleState.role] ?? roleState.role} ${definition.label}`}>
                                  <input
                                    type="checkbox"
                                    checked={permission?.enabled === true}
                                    disabled={!canEditRolePermissions || permission?.locked === true}
                                    onChange={(event) => toggleRolePermission(roleState.role, definition.key, event.currentTarget.checked)}
                                  />
                                  <span>{permission?.locked ? "固定" : permission?.enabled ? "許可" : "なし"}</span>
                                </label>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="settings-permission-note">本部オーナーの基本権限は固定です。保存後、対象ユーザーは次回の画面読み込みから新しいナビゲーションになります。</p>
          </section>
          ) : null}

          {activeSection === "navigation" ? (
          <section className="panel settings-navigation-beta-panel">
            <div className="panel-title">
              <div>
                <h3>メニュー Beta 表示</h3>
                <p>OS メニューに表示する機能ごとの Beta ラベルを設定します。準備中や試験運用中の機能だけを選択してください。</p>
              </div>
              <button className="secondary-button" type="button" disabled={savingNavigationSettings} onClick={() => void saveNavigationSettings()}>
                <Save size={16} />
                {savingNavigationSettings ? "保存中" : "Beta 表示を保存"}
              </button>
            </div>
            <div className="settings-navigation-beta-groups">
              {navModules.map((module) => {
                const ModuleIcon = module.icon;
                const items = module.paths.flatMap((path) => {
                  const item = navigationItemByHref.get(path.href);
                  return item ? [item] : [];
                });
                if (!items.length) return null;

                return (
                  <section className="settings-navigation-beta-group" key={module.id}>
                    <div className="settings-navigation-beta-heading">
                      <ModuleIcon size={16} />
                      <strong>{module.label}</strong>
                    </div>
                    <div className="settings-navigation-beta-list">
                      {items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <label className="settings-navigation-beta-row" key={item.href}>
                            <span className="settings-navigation-beta-name">
                              <Icon size={15} />
                              <span>{item.label}</span>
                            </span>
                            <span className="settings-navigation-beta-control">
                              <input
                                type="checkbox"
                                checked={betaNavPathSet.has(item.href)}
                                onChange={(event) => toggleNavigationBeta(item.href, event.currentTarget.checked)}
                              />
                              <span>Beta</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
          ) : null}

          {activeSection === "payroll" ? (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>給与・税設定</h3>
                <p>源泉徴収税額表をアップロードします。給与計算では従業員ごとの甲乙区分と扶養人数に基づいて源泉所得税を控除します。</p>
              </div>
            </div>
            {payrollAlerts.length ? (
              <div className="statutory-alert-list is-settings">
                {payrollAlerts.map((alert) => (
                  <article className={`statutory-alert-card is-${alert.level}`} key={alert.key}>
                    <div>
                      <span>{alert.dueLabel}</span>
                      <h4>{alert.title}</h4>
                      <p>{alert.message}</p>
                    </div>
                    <strong>{alert.actionLabel}</strong>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="settings-allowance-panel">
              <div className="settings-manual-rate-heading">
                <div>
                  <strong>手当・加給ルール</strong>
                  <span>時間帯の時給加算率、Uber売上別の勤務手当、月額手当、ワンオペ加給を給与明細に反映します。既存ルールを変更する場合は停止して新しく作成してください。</span>
                </div>
              </div>
              <div className="settings-allowance-form">
                <label className="settings-field">
                  <span>種類</span>
                  <select value={allowanceRuleType} onChange={(event) => {
                    const nextType = event.target.value as PayrollAllowanceRule["ruleType"];
                    setAllowanceRuleType(nextType);
                    if (nextType === "time_performance_multiplier") {
                      setAllowanceStartTime("20:00");
                      setAllowanceEndTime("22:00");
                    } else if (nextType === "performance_tier_per_shift") {
                      setAllowanceStartTime("00:00");
                      setAllowanceEndTime("05:00");
                    }
                  }}>
                    <option value="time_performance_multiplier">時間帯の時給加算率（%）</option>
                    <option value="performance_tier_per_shift">Uber売上別の勤務手当（定額）</option>
                    <option value="one_person_busy_hourly">ワンオペ繁忙加給（時給に金額加算）</option>
                    <option value="fixed_monthly">固定手当（月額）</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>名称</span>
                  <input value={allowanceName} onChange={(event) => setAllowanceName(event.target.value)} placeholder={allowanceRuleType === "fixed_monthly" ? "例: 店長手当" : allowanceRuleType === "time_performance_multiplier" ? "例: 20〜22時 高負荷枠" : allowanceRuleType === "performance_tier_per_shift" ? "例: 深夜担当者手当" : "例: ワンオペ繁忙加給"} />
                </label>
                {allowanceRuleType === "fixed_monthly" || allowanceRuleType === "one_person_busy_hourly" ? (
                  <label className="settings-field">
                    <span>{allowanceRuleType === "fixed_monthly" ? "月額" : "加給時給"}</span>
                    <input value={allowanceAmount} inputMode="numeric" onChange={(event) => setAllowanceAmount(normalizeIntegerInput(event.target.value))} placeholder={allowanceRuleType === "fixed_monthly" ? "例: 10000" : "例: 100"} />
                  </label>
                ) : null}
                <label className="settings-field">
                  <span>対象店舗</span>
                  <select value={allowanceStoreId} onChange={(event) => setAllowanceStoreId(event.target.value)}>
                    <option value="">全店舗</option>
                    {payrollAllowanceStores.map((store) => (
                      <option value={store.id} key={store.id}>{store.name}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>対象従業員</span>
                  <select value={allowanceEmployeeId} onChange={(event) => setAllowanceEmployeeId(event.target.value)}>
                    <option value="">全員</option>
                    {payrollAllowanceEmployees.map((employee) => (
                      <option value={employee.id} key={employee.id}>{employee.name}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>有効開始</span>
                  <input type="date" value={allowanceValidFrom} onChange={(event) => setAllowanceValidFrom(event.target.value)} />
                </label>
                <label className="settings-field">
                  <span>有効終了</span>
                  <input type="date" value={allowanceValidTo} onChange={(event) => setAllowanceValidTo(event.target.value)} />
                </label>
                {allowanceRuleType === "time_performance_multiplier" ? (
                  <>
                    <label className="settings-field">
                      <span>通常時給への保証加算率（%）</span>
                      <input value={allowanceBasePercent} inputMode="decimal" onChange={(event) => setAllowanceBasePercent(event.target.value)} placeholder="25" />
                    </label>
                    <label className="settings-field">
                      <span>条件達成時の加算率（%）</span>
                      <input value={allowanceTriggerPercent} inputMode="decimal" onChange={(event) => setAllowanceTriggerPercent(event.target.value)} placeholder="50" />
                    </label>
                    <label className="settings-field">
                      <span>Uber売上条件</span>
                      <input value={allowanceSalesThreshold} inputMode="numeric" onChange={(event) => setAllowanceSalesThreshold(normalizeIntegerInput(event.target.value))} placeholder="50000" />
                    </label>
                    <label className="settings-field">
                      <span>Uber注文数条件</span>
                      <input value={allowanceOrderThreshold} inputMode="numeric" onChange={(event) => setAllowanceOrderThreshold(normalizeIntegerInput(event.target.value))} placeholder="15" />
                    </label>
                    <p className="settings-field-note">
                      通常時給に加算します。25%なら1.25倍、50%なら1.5倍です。売上または注文数のどちらかを達成すると条件達成時の加算率を適用します。
                    </p>
                  </>
                ) : null}
                {allowanceRuleType === "performance_tier_per_shift" ? (
                  <div className="settings-allowance-tiers">
                    <div className="settings-allowance-tier-heading">
                      <div>
                        <strong>Uber売上別の1勤務手当</strong>
                        <span>条件は自由に追加できます。該当する最も高い売上条件の手当を1勤務につき1回だけ支給します。</span>
                      </div>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setAllowanceTiers((current) => [...current, { salesThreshold: "", amount: "" }])}
                      >
                        条件を追加
                      </button>
                    </div>
                    {allowanceTiers.map((tier, index) => (
                      <div className="settings-allowance-tier-row" key={index}>
                        <label className="settings-field">
                          <span>Uber売上（税込）以上</span>
                          <input value={tier.salesThreshold} inputMode="numeric" onChange={(event) => setAllowanceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, salesThreshold: normalizeIntegerInput(event.target.value) } : item))} />
                        </label>
                        <label className="settings-field">
                          <span>1勤務の手当</span>
                          <input value={tier.amount} inputMode="numeric" onChange={(event) => setAllowanceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: normalizeIntegerInput(event.target.value) } : item))} />
                        </label>
                        <button
                          aria-label={`売上条件${index + 1}を削除`}
                          className="text-button is-danger"
                          type="button"
                          disabled={allowanceTiers.length === 1}
                          onClick={() => setAllowanceTiers((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {allowanceRuleType !== "fixed_monthly" ? (
                  <>
                    <label className="settings-field">
                      <span>対象開始</span>
                      <input type="time" value={allowanceStartTime} onChange={(event) => setAllowanceStartTime(event.target.value)} />
                    </label>
                    <label className="settings-field">
                      <span>対象終了</span>
                      <input type="time" value={allowanceEndTime} onChange={(event) => setAllowanceEndTime(event.target.value)} />
                    </label>
                    <div className="settings-allowance-weekdays">
                      {weekdayLabels.map((label, index) => (
                        <label key={label}>
                          <input type="checkbox" checked={allowanceWeekdays.includes(index)} onChange={(event) => toggleAllowanceWeekday(index, event.currentTarget.checked)} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </>
                ) : null}
                <button className="secondary-button" type="button" disabled={savingPayrollAllowance} onClick={() => void createPayrollAllowanceRule()}>
                  <Save size={16} />
                  {savingPayrollAllowance ? "保存中" : "ルールを追加"}
                </button>
              </div>
              <div className="settings-allowance-list">
                {payrollAllowanceRules.length ? payrollAllowanceRules.map((rule) => (
                  <article className={rule.isEnabled ? "" : "is-disabled"} key={rule.id}>
                    <div>
                      <strong>{rule.name}</strong>
                      <span>
                        {rule.ruleType === "fixed_monthly"
                          ? "固定手当"
                          : rule.ruleType === "time_performance_multiplier"
                            ? `時給加算 +${Math.round(((rule.baseMultiplier ?? 1) - 1) * 100)}% → +${Math.round(((rule.triggerMultiplier ?? 1) - 1) * 100)}%`
                            : rule.ruleType === "performance_tier_per_shift"
                              ? "業績連動・勤務手当"
                              : "ワンオペ繁忙加給"}
                        {" / "}{rule.storeName ?? "全店舗"}
                        {" / "}{rule.employeeName ?? "全員"}
                        {rule.ruleType === "fixed_monthly" || rule.ruleType === "one_person_busy_hourly"
                          ? ` / ¥${Math.round(rule.amount).toLocaleString("ja-JP")}`
                          : null}
                      </span>
                      {rule.ruleType === "time_performance_multiplier" ? (
                        <small>Uber売上 ¥{Math.round(rule.salesThreshold ?? 0).toLocaleString("ja-JP")} または {rule.orderThreshold ?? 0}件以上</small>
                      ) : null}
                      {rule.ruleType === "performance_tier_per_shift" ? (
                        <small>{rule.tiers.map((tier) => `¥${tier.salesThreshold.toLocaleString("ja-JP")}以上: ¥${tier.amount.toLocaleString("ja-JP")}`).join("、")}</small>
                      ) : null}
                      {rule.windows.length ? <small>{rule.windows.map((window) => `${weekdayLabels[window.weekday] ?? ""} ${window.startTime}-${window.endTime}`).join("、")}</small> : null}
                    </div>
                    {rule.isEnabled ? (
                      <button className="text-button" type="button" onClick={() => void disablePayrollAllowanceRule(rule.id)}>停止</button>
                    ) : (
                      <span className="status-pill">停止中</span>
                    )}
                  </article>
                )) : (
                  <p className="empty-state-text">手当・加給ルールはまだありません。</p>
                )}
              </div>
            </div>
            <div className="settings-tax-import">
              <label className="settings-field">
                <span>対象年</span>
                <input value={taxYear} inputMode="numeric" onChange={(event) => setTaxYear(normalizeIntegerInput(event.target.value))} placeholder="例: 2026" />
              </label>
              <label className="settings-field">
                <span>源泉税表ファイル</span>
                <input
                  key={taxFile ? "tax-file-selected" : "tax-file-empty"}
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={(event) => setTaxFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button className="secondary-button" type="button" disabled={!taxFile || uploadingTaxTable} onClick={() => void uploadWithholdingTaxTable()}>
                <Upload size={16} />
                {uploadingTaxTable ? "取り込み中" : "源泉税表を取り込む"}
              </button>
            </div>
            <div className="settings-tax-import">
              <label className="settings-field">
                <span>対象年度</span>
                <input value={socialInsuranceYear} inputMode="numeric" onChange={(event) => setSocialInsuranceYear(normalizeIntegerInput(event.target.value))} placeholder="例: 2026" />
              </label>
              <label className="settings-field">
                <span>社会保険料表 Excel</span>
                <input
                  key={socialInsuranceFile ? "social-file-selected" : "social-file-empty"}
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={(event) => setSocialInsuranceFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button className="secondary-button" type="button" disabled={!socialInsuranceFile || uploadingSocialInsurance} onClick={() => void uploadSocialInsuranceTable()}>
                <Upload size={16} />
                {uploadingSocialInsurance ? "取り込み中" : "社会保険料表を取り込む"}
              </button>
            </div>
            <div className="settings-tax-import">
              <label className="settings-field">
                <span>対象年度</span>
                <input value={employmentInsuranceYear} inputMode="numeric" onChange={(event) => updateEmploymentInsuranceYear(normalizeIntegerInput(event.target.value))} placeholder="例: 2026" />
              </label>
              <label className="settings-field">
                <span>雇用保険料率 PDF</span>
                <input
                  key={employmentInsuranceFile ? "employment-file-selected" : "employment-file-empty"}
                  type="file"
                  accept=".pdf"
                  onChange={(event) => setEmploymentInsuranceFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button className="secondary-button" type="button" disabled={!employmentInsuranceFile || uploadingEmploymentInsurance} onClick={() => void uploadEmploymentInsuranceTable()}>
                <Upload size={16} />
                {uploadingEmploymentInsurance ? "取り込み中" : "雇用保険料率を取り込む"}
              </button>
            </div>
            <div className="settings-manual-rate-panel">
              <div className="settings-manual-rate-heading">
                <div>
                  <strong>雇用保険料率を手動入力</strong>
                  <span>PDF が読み取れない場合は、公式資料の数値を「/1000」で入力します。例: 5/1000 の場合は 5。</span>
                </div>
                <div className="settings-manual-period">
                  <b>{employmentInsuranceYear}年度</b>
                  <span>{employmentInsuranceEffectiveFrom}〜{employmentInsuranceEffectiveTo}</span>
                </div>
              </div>
              <div className="settings-manual-rate-controls">
                <label className="settings-field">
                  <span>入力する事業</span>
                  <select value={employmentInsuranceBusinessType} onChange={(event) => setEmploymentInsuranceBusinessType(event.target.value)}>
                    {employmentInsuranceManualRows.map((row) => (
                      <option value={row.businessType} key={row.businessType}>{row.label}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span>適用開始日</span>
                  <input type="date" value={employmentInsuranceEffectiveFrom} onChange={(event) => setEmploymentInsuranceEffectiveFrom(event.target.value)} />
                </label>
                <label className="settings-field">
                  <span>適用終了日</span>
                  <input type="date" value={employmentInsuranceEffectiveTo} onChange={(event) => setEmploymentInsuranceEffectiveTo(event.target.value)} />
                </label>
              </div>
              {employmentInsuranceManualRows.filter((row) => row.businessType === employmentInsuranceBusinessType).map((row) => (
                <div className="settings-manual-rate-card" key={row.businessType}>
                  <div>
                    <span>事業の種類</span>
                    <strong>{row.label}</strong>
                  </div>
                  <label>
                    <span>労働者負担</span>
                    <input name={`employmentManualEmployeeRate:${row.businessType}`} inputMode="decimal" defaultValue={row.employeeRate} onInput={(event) => { event.currentTarget.value = normalizeDecimalInput(event.currentTarget.value); }} placeholder="例: 5" aria-label={`${row.label} 労働者負担`} />
                    <small>/1000</small>
                  </label>
                  <label>
                    <span>事業主負担</span>
                    <input name={`employmentManualEmployerRate:${row.businessType}`} inputMode="decimal" defaultValue={row.employerRate} onInput={(event) => { event.currentTarget.value = normalizeDecimalInput(event.currentTarget.value); }} placeholder="例: 8.5" aria-label={`${row.label} 事業主負担`} />
                    <small>/1000</small>
                  </label>
                  <label>
                    <span>給付分</span>
                    <input name={`employmentManualBenefitRate:${row.businessType}`} inputMode="decimal" defaultValue={row.benefitRate} onInput={(event) => { event.currentTarget.value = normalizeDecimalInput(event.currentTarget.value); }} placeholder="例: 5" aria-label={`${row.label} 給付分`} />
                    <small>/1000</small>
                  </label>
                  <label>
                    <span>二事業分</span>
                    <input name={`employmentManualTwoProjectsRate:${row.businessType}`} inputMode="decimal" defaultValue={row.twoProjectsRate} onInput={(event) => { event.currentTarget.value = normalizeDecimalInput(event.currentTarget.value); }} placeholder="例: 3.5" aria-label={`${row.label} 二事業分`} />
                    <small>/1000</small>
                  </label>
                  <label>
                    <span>合計</span>
                    <input name={`employmentManualTotalRate:${row.businessType}`} inputMode="decimal" defaultValue={row.totalRate} onInput={(event) => { event.currentTarget.value = normalizeDecimalInput(event.currentTarget.value); }} placeholder="例: 13.5" aria-label={`${row.label} 合計`} />
                    <small>/1000</small>
                  </label>
                </div>
              ))}
              <button className="secondary-button" type="button" disabled={uploadingEmploymentInsurance} onClick={() => void saveManualEmploymentInsuranceTable()}>
                <Save size={16} />
                {uploadingEmploymentInsurance ? "保存中" : "手動入力した料率を保存"}
              </button>
            </div>
            <div className="settings-tax-table-list">
              {taxTables.length ? taxTables.map((table) => (
                <article key={table.id}>
                  <strong>{table.taxYear}年 / {table.title}</strong>
                  <span>{table.rowCount}行 / {table.sourceFileName ?? "ファイル名なし"} / {table.isActive ? "有効" : "無効"}</span>
                </article>
              )) : (
                <p className="empty-state-text">源泉税表はまだ登録されていません。</p>
              )}
              {socialInsuranceTables.map((table) => (
                <article key={table.id}>
                  <strong>{table.fiscalYear}年度 / {table.title}</strong>
                  <span>社会保険 {table.rowCount}行 / {table.sourceFileName ?? "ファイル名なし"}</span>
                </article>
              ))}
              {employmentInsuranceTables.map((table) => (
                <article key={table.id}>
                  <strong>{table.fiscalYear}年度 / {table.title} / {table.isActive ? "有効" : "履歴"}</strong>
                  <span>雇用保険 {table.rowCount}行 / {table.sourceFileName ?? "ファイル名なし"} / {String(table.effectiveFrom).slice(0, 10)}〜{String(table.effectiveTo).slice(0, 10)}</span>
                  {table.rows?.length ? (
                    <div className="settings-employment-history-rows">
                      {table.rows.map((row) => (
                        <small key={row.businessType}>
                          {row.label}: 労働者 {ratePermille(row.employeeRate)}/1000・事業主 {ratePermille(row.employerRate)}/1000・合計 {ratePermille(row.totalRate)}/1000
                        </small>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="statutory-schedule-list" aria-label="給与法定データ更新時期">
              <article>
                <strong>源泉所得税</strong>
                <span>毎年1月支給分から新しい税額表を使用。10月以降に翌年分の確認を開始します。</span>
              </article>
              <article>
                <strong>健康保険・介護保険</strong>
                <span>協会けんぽは例年3月分（4月納付分）から料率改定。2月から確認を開始します。</span>
              </article>
              <article>
                <strong>雇用保険</strong>
                <span>年度単位で4月1日から料率切替。3月から確認を開始します。</span>
              </article>
              <article>
                <strong>住民税</strong>
                <span>6月から翌年5月まで控除。5月から通知書に基づく手入力を促します。</span>
              </article>
              <article>
                <strong>標準報酬月額</strong>
                <span>定時決定後、原則9月から翌年8月まで使用。7月から確認を開始します。</span>
              </article>
            </div>
          </section>
          ) : null}

          {activeSection === "store" ? (
          <>
          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>Store ヘッダー</h3>
                <p>店舗現場画面の上部に表示する内容を設定します。現場画面はコンパクトに保つため、初期値はアイコンのみです。</p>
              </div>
            </div>
            <div className="settings-option-list">
              <ToggleRow label="時計を表示" checked={settings.header.showClock} onChange={(checked) => setSettings((current) => ({ ...current, header: { ...current.header, showClock: checked } }))} />
              <ToggleRow label="通知ボタンを表示" checked={settings.header.showNotifications} onChange={(checked) => setSettings((current) => ({ ...current, header: { ...current.header, showNotifications: checked } }))} />
              <ToggleRow label="言語切替を表示" checked={settings.header.showLanguagePicker} onChange={(checked) => setSettings((current) => ({ ...current, header: { ...current.header, showLanguagePicker: checked } }))} />
              <label className="settings-field">
                <span>ユーザー表示</span>
                <select
                  value={settings.header.userDisplay}
                  onChange={(event) => setSettings((current) => ({ ...current, header: { ...current.header, userDisplay: event.target.value as StoreModuleSettings["header"]["userDisplay"] } }))}
                >
                  <option value="avatar">アイコンのみ</option>
                  <option value="name">名前のみ</option>
                  <option value="avatar_name">アイコン + 名前</option>
                </select>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>Store 注文通知音</h3>
                <p>Web予約の新規注文を店舗現場で見落とさないための前面通知音を設定します。APK では手動の音声有効化なしで再生できます。</p>
              </div>
            </div>
            <div className="settings-option-list">
              <label className="settings-field">
                <span>通知音</span>
                <select
                  value={settings.orderAlerts.sound}
                  onChange={(event) => setSettings((current) => ({ ...current, orderAlerts: { ...current.orderAlerts, sound: event.target.value as StoreModuleSettings["orderAlerts"]["sound"] } }))}
                >
                  {storeOrderAlertSoundOptions.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="settings-option-help">
                {storeOrderAlertSoundOptions.find((option) => option.value === settings.orderAlerts.sound)?.description}
              </div>
              <div className="settings-sound-preview-grid" aria-label="通知音を再生">
                {storeOrderAlertSoundOptions.map((option) => (
                  <button className="secondary-button" type="button" key={option.value} onClick={() => void previewStoreOrderAlertSound(option.value)}>
                    {option.label} 再生
                  </button>
                ))}
              </div>
              <ToggleRow label="未対応の新規注文を30秒・60秒後に再通知" checked={settings.orderAlerts.repeatUntilHandled} onChange={(checked) => setSettings((current) => ({ ...current, orderAlerts: { ...current.orderAlerts, repeatUntilHandled: checked } }))} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>Store 販売状態</h3>
                <p>店舗現場で売り切れ、販売再開、メモ入力を扱う対象を設定します。</p>
              </div>
            </div>
            <div className="settings-option-list">
              <ToggleRow label="商品を店舗で管理" checked={settings.availability.targets.items} onChange={(checked) => setSettings((current) => ({ ...current, availability: { ...current.availability, targets: { ...current.availability.targets, items: checked } } }))} />
              <ToggleRow label="オプション・トッピングを店舗で管理" checked={settings.availability.targets.options} onChange={(checked) => setSettings((current) => ({ ...current, availability: { ...current.availability, targets: { ...current.availability.targets, options: checked } } }))} />
              <label className="settings-field">
                <span>オプション表示方式</span>
                <select
                  value={settings.availability.optionDisplayMode}
                  onChange={(event) => setSettings((current) => ({ ...current, availability: { ...current.availability, optionDisplayMode: event.target.value as StoreModuleSettings["availability"]["optionDisplayMode"] } }))}
                  disabled={!settings.availability.targets.options}
                >
                  <option value="separate_category">左側に独立分類として表示</option>
                  <option value="mixed">商品一覧の上に混合表示</option>
                  <option value="hidden">表示しない</option>
                </select>
              </label>
              <ToggleRow label="店舗の価格変更を許可" checked={settings.availability.allowStorePriceEdit} onChange={(checked) => setSettings((current) => ({ ...current, availability: { ...current.availability, allowStorePriceEdit: checked } }))} />
              <ToggleRow label="Web / POS などの販売チャネル停止を許可" checked={settings.availability.allowChannelToggle} onChange={(checked) => setSettings((current) => ({ ...current, availability: { ...current.availability, allowChannelToggle: checked } }))} />
            </div>
          </section>
          </>
          ) : null}
        </section>
      </section>
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="settings-toggle-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
