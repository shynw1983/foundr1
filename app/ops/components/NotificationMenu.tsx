"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

type OpsNotification = {
  id: string;
  title: string;
  message: string;
  href: string;
  readAt: string | null;
};

export function NotificationMenu({ className = "" }: { className?: string }) {
  const [notifications, setNotifications] = useState<OpsNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

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

  useEffect(() => {
    void loadNotifications();
    const intervalId = window.setInterval(() => void loadNotifications(), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  async function markNotificationsRead() {
    await fetch("/api/notifications", { method: "PATCH" });
    setUnreadCount(0);
    setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
  }

  return (
    <details className={["notification-menu", className].filter(Boolean).join(" ")}>
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
  );
}
