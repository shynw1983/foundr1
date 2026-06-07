"use client";

import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type StoreVersionNoticeProps = {
  initialVersion: string;
  initialShortVersion: string;
};

type VersionResponse = {
  version?: string;
  shortVersion?: string;
};

type RealtimeConfigResponse = {
  key?: string;
  cluster?: string;
  versionChannel?: string;
  channels?: string[];
};

type VersionEventPayload = {
  version?: string;
  shortVersion?: string;
};

const checkIntervalMs = 60_000;
const hiddenPaths = new Set([
  "/store/pos/customer-display"
]);

export function StoreVersionNotice({ initialVersion, initialShortVersion }: StoreVersionNoticeProps) {
  const pathname = usePathname();
  const [latestShortVersion, setLatestShortVersion] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const currentVersionRef = useRef(initialVersion);
  const isHiddenPath = hiddenPaths.has(pathname);

  useEffect(() => {
    currentVersionRef.current = initialVersion;
  }, [initialVersion]);

  const showUpdateNotice = (version: string, shortVersion?: string) => {
    if (!version || version === currentVersionRef.current) return;
    setLatestShortVersion(shortVersion || version.slice(0, 7));
    setUpdateAvailable(true);
  };

  useEffect(() => {
    if (isHiddenPath || !initialVersion || initialVersion === "local") return;
    let active = true;
    let timer = 0;

    const checkVersion = async () => {
      try {
        const response = await fetch(`/api/store/version?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const body = await response.json() as VersionResponse;
        const nextVersion = String(body.version ?? "");
        showUpdateNotice(nextVersion, body.shortVersion);
      } catch {
        // Version checks should never interrupt store work.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    const handleFocus = () => {
      void checkVersion();
    };

    void checkVersion();
    timer = window.setInterval(checkVersion, checkIntervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [initialVersion, isHiddenPath]);

  useEffect(() => {
    if (isHiddenPath || !initialVersion || initialVersion === "local") return;
    let active = true;
    let pusher: any;
    let channels: any[] = [];

    const handleVersionUpdated = (payload: VersionEventPayload) => {
      showUpdateNotice(String(payload.version ?? ""), payload.shortVersion);
    };

    fetch("/api/store/realtime-config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config: RealtimeConfigResponse | null) => {
        if (!active || !config?.key || !config.cluster) return;
        const { default: Pusher } = await import("pusher-js");
        if (!active) return;
        pusher = new Pusher(config.key, {
          cluster: config.cluster,
          channelAuthorization: {
            endpoint: "/api/store/realtime-auth",
            transport: "ajax"
          }
        });
        channels = [config.versionChannel, ...(config.channels ?? [])].filter(Boolean).map((channelName) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("store.version.updated", handleVersionUpdated);
          return channel;
        });
      })
      .catch(() => {
        // Polling remains the fallback when realtime is unavailable.
      });

    return () => {
      active = false;
      channels.forEach((channel) => {
        channel.unbind("store.version.updated", handleVersionUpdated);
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
  }, [initialVersion, isHiddenPath]);

  useEffect(() => {
    if (isHiddenPath || !initialVersion || initialVersion === "local") return;
    const publishedKey = `store:version-published:${initialVersion}`;
    if (window.sessionStorage.getItem(publishedKey) === "1") return;
    window.sessionStorage.setItem(publishedKey, "1");
    void fetch("/api/store/version", {
      method: "POST",
      cache: "no-store"
    }).catch(() => {
      window.sessionStorage.removeItem(publishedKey);
    });
  }, [initialVersion, isHiddenPath]);

  if (isHiddenPath || !updateAvailable) return null;

  return (
    <div className="store-version-notice" role="status" aria-live="polite">
      <div>
        <strong>新しい Store 版があります</strong>
        <span>現在 {initialShortVersion} / 最新 {latestShortVersion || "更新あり"}</span>
      </div>
      <button type="button" onClick={() => window.location.reload()}>
        <RefreshCw size={16} />
        更新
      </button>
    </div>
  );
}
