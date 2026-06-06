"use client";

import { LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NotificationMenu } from "./NotificationMenu";
import { OsLanguagePicker } from "./OsTranslationProvider";
import { getCachedCurrentEmployee, loadCurrentEmployee, type CurrentEmployee } from "./currentEmployeeStore";
import { useCloseOnOutside } from "./useCloseOnOutside";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  store_owner: "加盟店オーナー",
  store_manager: "店長",
  store_terminal: "店舗Pad",
  staff: "Staff",
  buyer: "購入担当"
};

function getInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

export function UserBadge({
  showNotifications = true,
  showLanguagePicker = true
}: {
  showNotifications?: boolean;
  showLanguagePicker?: boolean;
}) {
  const [employee, setEmployee] = useState<CurrentEmployee | null>(() => getCachedCurrentEmployee());
  const accountMenuRef = useRef<HTMLDetailsElement | null>(null);

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

  useCloseOnOutside(accountMenuRef, () => {
    if (accountMenuRef.current) accountMenuRef.current.open = false;
  }, Boolean(employee));

  if (!employee) {
    return (
      <div className="user-panel">
        <span className="user-badge user-badge-muted">
          <span className="user-avatar" aria-hidden="true">...</span>
          <span className="user-badge-name">ログイン確認中</span>
        </span>
        {showNotifications ? <span className="notification-placeholder" aria-hidden="true" /> : null}
        {showLanguagePicker ? <OsLanguagePicker /> : null}
      </div>
    );
  }

  return (
    <div className="user-panel">
      <details className="account-menu" ref={accountMenuRef}>
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
      {showNotifications ? <NotificationMenu /> : null}
      {showLanguagePicker ? <OsLanguagePicker /> : null}
    </div>
  );
}
