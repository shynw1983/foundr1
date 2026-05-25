"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { OpsLanguagePicker } from "./OpsTranslationProvider";

type CurrentEmployee = {
  name: string;
  loginId: string;
  role: string;
};
type OpsNotification = {
  id: string;
  title: string;
  message: string;
  href: string;
  readAt: string | null;
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
  const [notifications, setNotifications] = useState<OpsNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    async function loadCurrentUser() {
      const response = await fetch("/api/auth/me");
      if (!response.ok) return;
      const body = await response.json() as { employee?: CurrentEmployee };
      if (body.employee) setEmployee(body.employee);
    }

    void loadCurrentUser();
  }, []);

  useEffect(() => {
    async function loadNotifications() {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as {
        notifications?: OpsNotification[];
        unreadCount?: number;
      };
      setNotifications(body.notifications ?? []);
      setUnreadCount(body.unreadCount ?? 0);
    }

    void loadNotifications();
    const intervalId = window.setInterval(() => void loadNotifications(), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  async function markNotificationsRead() {
    await fetch("/api/notifications", { method: "PATCH" });
    setUnreadCount(0);
    setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
  }

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
      <details className="notification-menu">
        <summary aria-label="通知">
          <Bell size={16} />
          {unreadCount > 0 ? <span>{unreadCount}</span> : null}
        </summary>
        <div className="notification-panel">
          <div className="notification-heading">
            <strong>通知</strong>
            <button type="button" onClick={() => void markNotificationsRead()}>既読</button>
          </div>
          {notifications.length > 0 ? notifications.map((item) => (
            <a className={item.readAt ? "notification-item" : "notification-item is-unread"} href={item.href || "/ops/procurement"} key={item.id}>
              <strong>{item.title}</strong>
              <span>{item.message}</span>
            </a>
          )) : (
            <div className="notification-empty">通知はありません</div>
          )}
        </div>
      </details>
      <OpsLanguagePicker />
    </div>
  );
}
