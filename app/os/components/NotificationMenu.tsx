"use client";

import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type OsNotification = {
  id: string;
  title: string;
  message: string;
  href: string;
  readAt: string | null;
};

export function NotificationMenu({ className = "" }: { className?: string }) {
  const [notifications, setNotifications] = useState<OsNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notificationMenuRef = useRef<HTMLDetailsElement | null>(null);

  async function loadNotifications() {
    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as {
      notifications?: OsNotification[];
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

  useEffect(() => {
    const notificationMenu = notificationMenuRef.current;
    if (!notificationMenu) return;

    function closeMenu() {
      if (notificationMenu) notificationMenu.open = false;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!notificationMenu?.contains(event.target as Node)) closeMenu();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function markNotificationsRead() {
    await fetch("/api/notifications", { method: "PATCH" });
    setUnreadCount(0);
    setNotifications([]);
  }

  return (
    <details className={["notification-menu", className].filter(Boolean).join(" ")} ref={notificationMenuRef}>
      <summary aria-label="通知">
        <Bell size={16} />
        {unreadCount > 0 ? <span>{unreadCount}</span> : null}
      </summary>
      <div className="notification-panel">
        <div className="notification-heading">
          <strong>通知</strong>
          <button type="button" onClick={() => void markNotificationsRead()} disabled={unreadCount === 0}>すべて既読</button>
        </div>
        {notifications.length > 0 ? notifications.map((item) => (
          <a className={item.readAt ? "notification-item" : "notification-item is-unread"} href={item.href || "/os/procurement"} key={item.id}>
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
