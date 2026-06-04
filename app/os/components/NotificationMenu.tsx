"use client";

import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCloseOnOutside } from "./useCloseOnOutside";

type OsNotification = {
  id: string;
  title: string;
  message: string;
  href: string;
  readAt: string | null;
};

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function NotificationMenu({ className = "" }: { className?: string }) {
  const [notifications, setNotifications] = useState<OsNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushState, setPushState] = useState<"hidden" | "ready" | "enabled" | "unsupported" | "disabled">("hidden");
  const [pushMessage, setPushMessage] = useState("");
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
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushState("disabled");
      return;
    }
    if (Notification.permission !== "granted") {
      setPushState("ready");
      return;
    }
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushState(subscription ? "enabled" : "ready"))
      .catch(() => setPushState("ready"));
  }, []);

  useCloseOnOutside(notificationMenuRef, () => {
    if (notificationMenuRef.current) notificationMenuRef.current.open = false;
  });

  async function markNotificationsRead() {
    await fetch("/api/notifications", { method: "PATCH" });
    setUnreadCount(0);
    setNotifications([]);
  }

  async function enableWebPush() {
    setPushMessage("");
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
      setPushMessage("この端末ではプッシュ通知を利用できません。");
      return;
    }
    const configResponse = await fetch("/api/notifications/web-push-public-key", { cache: "no-store" });
    const config = await configResponse.json().catch(() => ({})) as { enabled?: boolean; publicKey?: string; error?: string };
    if (!configResponse.ok || !config.enabled || !config.publicKey) {
      setPushMessage(config.error ?? "プッシュ通知の設定が未完了です。");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPushState(permission === "denied" ? "disabled" : "ready");
      setPushMessage("通知が許可されませんでした。");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey)
    });
    const response = await fetch("/api/notifications/web-push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setPushMessage(body.error ?? "通知端末を保存できませんでした。");
      return;
    }
    setPushState("enabled");
    setPushMessage("この端末へのプッシュ通知を有効にしました。");
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
        {pushState === "ready" ? (
          <button className="notification-push-button" type="button" onClick={() => void enableWebPush()}>プッシュ通知を許可</button>
        ) : null}
        {pushState === "enabled" ? <div className="notification-push-status">プッシュ通知は有効です</div> : null}
        {pushMessage ? <div className="notification-push-status">{pushMessage}</div> : null}
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
