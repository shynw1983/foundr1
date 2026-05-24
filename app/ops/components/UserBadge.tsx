"use client";

import { useEffect, useState } from "react";
import { OpsLanguagePicker } from "./OpsTranslationProvider";

type CurrentEmployee = {
  name: string;
  loginId: string;
  role: string;
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  store_owner: "加盟店オーナー",
  staff: "Staff",
  buyer: "購入担当"
};

export function UserBadge() {
  const [employee, setEmployee] = useState<CurrentEmployee | null>(null);

  useEffect(() => {
    async function loadCurrentUser() {
      const response = await fetch("/api/auth/me");
      if (!response.ok) return;
      const body = await response.json() as { employee?: CurrentEmployee };
      if (body.employee) setEmployee(body.employee);
    }

    void loadCurrentUser();
  }, []);

  if (!employee) {
    return (
      <div className="user-panel">
        <span className="user-badge user-badge-muted">ログイン確認中</span>
        <OpsLanguagePicker />
      </div>
    );
  }

  return (
    <div className="user-panel">
      <span className="user-badge" title={`ログインID: ${employee.loginId}`}>
        <span className="user-badge-name">{employee.name}</span>
        <span className="user-badge-role">{roleLabels[employee.role] ?? employee.role}</span>
      </span>
      <OpsLanguagePicker />
    </div>
  );
}
