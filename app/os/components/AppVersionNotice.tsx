"use client";

import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type AppVersionNoticeProps = {
  appName: string;
  initialVersion: string;
  initialShortVersion: string;
  hiddenPaths?: string[];
  pathPrefixes?: string[];
  versionEndpoint?: string;
  publishEndpoint?: string;
  realtimeConfigEndpoint?: string;
  realtimeEventName?: string;
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

const fallbackCheckIntervalMs = 10 * 60_000;

export function AppVersionNotice({
  appName,
  initialVersion,
  initialShortVersion,
  hiddenPaths = [],
  pathPrefixes,
  versionEndpoint = "/api/app/version",
  publishEndpoint,
  realtimeConfigEndpoint,
  realtimeEventName = "app.version.updated"
}: AppVersionNoticeProps) {
  const pathname = usePathname();
  const [latestShortVersion, setLatestShortVersion] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const currentVersionRef = useRef(initialVersion);
  const isIncludedPath = !pathPrefixes?.length || pathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isHiddenPath = hiddenPaths.includes(pathname);

  useEffect(() => {
    currentVersionRef.current = initialVersion;
  }, [initialVersion]);

  const showUpdateNotice = useCallback((version: string, shortVersion?: string) => {
    if (!version || version === currentVersionRef.current) return;
    setLatestShortVersion(shortVersion || version.slice(0, 7));
    setUpdateAvailable(true);
  }, []);

  useEffect(() => {
    if (!isIncludedPath || isHiddenPath || !initialVersion || initialVersion === "local") return;
    let active = true;
    let timer = 0;

    const checkVersion = async () => {
      try {
        const response = await fetch(`${versionEndpoint}${versionEndpoint.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const body = await response.json() as VersionResponse;
        showUpdateNotice(String(body.version ?? ""), body.shortVersion);
      } catch {
        // Version checks should never interrupt app work.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    const handleFocus = () => {
      void checkVersion();
    };

    void checkVersion();
    if (!realtimeConfigEndpoint) timer = window.setInterval(checkVersion, fallbackCheckIntervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [initialVersion, isHiddenPath, isIncludedPath, realtimeConfigEndpoint, showUpdateNotice, versionEndpoint]);

  useEffect(() => {
    if (!isIncludedPath || isHiddenPath || !realtimeConfigEndpoint || !initialVersion || initialVersion === "local") return;
    let active = true;
    let pusher: any;
    let channels: any[] = [];

    const handleVersionUpdated = (payload: VersionEventPayload) => {
      showUpdateNotice(String(payload.version ?? ""), payload.shortVersion);
    };

    fetch(realtimeConfigEndpoint, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config: RealtimeConfigResponse | null) => {
        if (!active || !config?.key || !config.cluster) return;
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        channels = [config.versionChannel, ...(config.channels ?? [])].filter(Boolean).map((channelName) => {
          const channel = pusher.subscribe(channelName);
          channel.bind(realtimeEventName, handleVersionUpdated);
          return channel;
        });
      })
      .catch(() => {
        // Polling remains the fallback when realtime is unavailable.
      });

    return () => {
      active = false;
      channels.forEach((channel) => {
        channel.unbind(realtimeEventName, handleVersionUpdated);
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
  }, [initialVersion, isHiddenPath, isIncludedPath, realtimeConfigEndpoint, realtimeEventName, showUpdateNotice]);

  useEffect(() => {
    if (!isIncludedPath || isHiddenPath || !publishEndpoint || !initialVersion || initialVersion === "local") return;
    const publishedKey = `${appName}:version-published:${initialVersion}`;
    if (window.sessionStorage.getItem(publishedKey) === "1") return;
    window.sessionStorage.setItem(publishedKey, "1");
    void fetch(publishEndpoint, {
      method: "POST",
      cache: "no-store"
    }).catch(() => {
      window.sessionStorage.removeItem(publishedKey);
    });
  }, [appName, initialVersion, isHiddenPath, isIncludedPath, publishEndpoint]);

  if (!isIncludedPath || isHiddenPath || !updateAvailable) return null;

  return (
    <div className="app-version-notice" role="status" aria-live="polite">
      <div>
        <strong>新しい {appName} 版があります</strong>
        <span>現在 {initialShortVersion} / 最新 {latestShortVersion || "更新あり"}</span>
      </div>
      <button type="button" onClick={() => window.location.reload()}>
        <RefreshCw size={16} />
        更新
      </button>
    </div>
  );
}
