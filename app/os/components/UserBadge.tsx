"use client";

import { LogOut, UserRound } from "lucide-react";
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

function getInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

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
        <span className="user-badge user-badge-muted">
          <span className="user-avatar" aria-hidden="true">...</span>
          <span className="user-badge-name">ログイン確認中</span>
        </span>
        <span className="notification-placeholder" aria-hidden="true" />
        <OsLanguagePicker />
      </div>
    );
  }

  return (
    <div className="user-panel">
      <details className="account-menu">
        <summary className="user-badge" title={`ログインID: ${employee.loginId}`}>
          <span className="user-avatar" aria-hidden="true">{getInitial(employee.name)}</span>
          <span className="user-badge-name">{employee.name}</span>
          <span className="user-badge-role">{roleLabels[employee.role] ?? employee.role}</span>
        </summary>
        <div className="account-menu-panel">
          <div className="account-menu-user">
            <UserRound size={16} />
            <div>
              <strong>{employee.name}</strong>
              <span>{employee.loginId}</span>
            </div>
          </div>
          <a href="/os/logout">
            <LogOut size={16} />
            ログアウト
          </a>
        </div>
      </details>
      <NotificationMenu />
      <OsLanguagePicker />
    </div>
  );
}
