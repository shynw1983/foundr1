"use client";

import { useEffect, useState } from "react";
import { NotificationMenu } from "./NotificationMenu";
import { OsLanguagePicker } from "./OsTranslationProvider";
import { getCachedCurrentEmployee, loadCurrentEmployee, type CurrentEmployee } from "./currentEmployeeStore";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  store_owner: "加盟店オーナー",
  staff: "Staff",
  buyer: "購入担当"
};

export function UserBadge() {
  const [employee, setEmployee] = useState<CurrentEmployee | null>(() => getCachedCurrentEmployee());

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      const currentEmployee = await loadCurrentEmployee();
      if (isMounted) setEmployee(currentEmployee);
    }

    void loadCurrentUser();

    return () => {
      isMounted = false;
    };
  }, []);

  if (!employee) {
    return (
      <div className="user-panel">
        <span className="user-badge user-badge-muted">ログイン確認中</span>
        <OsLanguagePicker />
      </div>
    );
  }

  return (
    <div className="user-panel">
      <span className="user-badge" title={`ログインID: ${employee.loginId}`}>
        <span className="user-badge-name">{employee.name}</span>
        <span className="user-badge-role">{roleLabels[employee.role] ?? employee.role}</span>
      </span>
      <NotificationMenu />
      <OsLanguagePicker />
    </div>
  );
}
