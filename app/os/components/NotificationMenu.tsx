"use client";

import { Bell } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useCloseOnOutside } from "./useCloseOnOutside";

type OsNotification = {
  id: string;
  title: string;
  message: string;
  href: string;
  readAt: string | null;
};

type PushState = "hidden" | "ready" | "granted" | "saving" | "enabled" | "unsupported" | "disabled";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function getPushServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js");
}

export function NotificationMenu({ className = "" }: { className?: string }) {
  const [notifications, setNotifications] = useState<OsNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushState, setPushState] = useState<PushState>("hidden");
  const [pushMessage, setPushMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const notificationMenuRef = useRef<HTMLDetailsElement | null>(null);

  async function saveSubscription(subscription: PushSubscription) {
    const response = await fetch("/api/notifications/web-push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setPushState("granted");
      setPushMessage(body.error ?? "この端末の通知情報を保存できませんでした。");
      return false;
    }
    setPushState("enabled");
    return true;
  }

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
    void getPushServiceWorkerRegistration()
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        if (!subscription) {
          setPushState("granted");
          return;
        }
        setPushState("saving");
        await saveSubscription(subscription);
      })
      .catch(() => setPushState("granted"));
  }, []);

  useCloseOnOutside(notificationMenuRef, () => setIsOpen(false), isOpen);

  async function markNotificationsRead() {
    await fetch("/api/notifications", { method: "PATCH" });
    setUnreadCount(0);
    setNotifications([]);
    setIsOpen(false);
  }

  async function handleNotificationClick(event: MouseEvent<HTMLAnchorElement>, item: OsNotification) {
    event.preventDefault();
    const targetHref = item.href || "/os/procurement";
    setUnreadCount((current) => Math.max(0, current - (item.readAt ? 0 : 1)));
    setNotifications((current) => current.filter((notification) => notification.id !== item.id));
    setIsOpen(false);
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id })
    }).catch(() => undefined);
    window.location.assign(targetHref);
  }

  async function sendTestNotification() {
    setPushMessage("");
    const response = await fetch("/api/notifications/test-push", { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setPushMessage(body.error ?? "テスト通知を送信できませんでした。");
      return;
    }
    setPushMessage("テスト通知を送信しました。");
    setIsOpen(false);
    await loadNotifications();
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
    setPushState("saving");
    let subscription: PushSubscription;
    try {
      const registration = await getPushServiceWorkerRegistration();
      const existing = await registration.pushManager.getSubscription();
      subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey)
      });
    } catch {
      setPushState("granted");
      setPushMessage("通知は許可済みですが、この端末の登録に失敗しました。");
      return;
    }
    const saved = await saveSubscription(subscription);
    if (saved) {
      setPushMessage("この端末へのプッシュ通知を有効にしました。");
      window.setTimeout(() => setIsOpen(false), 700);
    }
  }

  return (
    <details className={["notification-menu", className].filter(Boolean).join(" ")} open={isOpen} ref={notificationMenuRef}>
      <summary aria-label="通知" onClick={(event) => {
        event.preventDefault();
        setIsOpen((current) => !current);
      }}>
        <Bell size={16} />
        {unreadCount > 0 ? <span>{unreadCount}</span> : null}
      </summary>
      <div className="notification-panel">
        <div className="notification-heading">
          <strong>通知</strong>
          <button type="button" onClick={() => void markNotificationsRead()} disabled={unreadCount === 0}>すべて既読</button>
        </div>
        {pushState === "ready" || pushState === "granted" || pushState === "saving" ? (
          <button className="notification-push-button" type="button" disabled={pushState === "saving"} onClick={() => void enableWebPush()}>
            {pushState === "ready" ? "プッシュ通知を許可" : pushState === "saving" ? "この端末を登録中" : "この端末を登録"}
          </button>
        ) : null}
        {pushState === "enabled" ? (
          <button className="notification-push-button" type="button" onClick={() => void sendTestNotification()}>
            テスト通知
          </button>
        ) : null}
        {pushState === "enabled" ? <div className="notification-push-status">プッシュ通知は有効です</div> : null}
        {pushMessage ? <div className="notification-push-status">{pushMessage}</div> : null}
        {notifications.length > 0 ? notifications.map((item) => (
          <a
            className={item.readAt ? "notification-item" : "notification-item is-unread"}
            href={item.href || "/os/procurement"}
            key={item.id}
            onClick={(event) => void handleNotificationClick(event, item)}
          >
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
