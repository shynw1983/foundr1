"use client";

import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { appVersionEndpoints, publishAppVersionOnce, subscribeToAppVersion, type AppVersionSnapshot } from "../../../lib/app-version-client";
import { isContentAppVersion, type AppVersionScope } from "../../../lib/app-version-protocol";

type AppVersionNoticeProps = {
  appId: AppVersionScope;
  appName: string;
  initialVersion: string;
  initialShortVersion: string;
  hiddenPaths?: string[];
  pathPrefixes?: string[];
  versionEndpoint?: string;
  publishEndpoint?: string;
  realtimeConfigEndpoint?: string;
};

export function AppVersionNotice({
  appId, appName, initialVersion, initialShortVersion, hiddenPaths, pathPrefixes,
  versionEndpoint, publishEndpoint, realtimeConfigEndpoint
}: AppVersionNoticeProps) {
  const pathname = usePathname();
  const [latest, setLatest] = useState<{ key: string; snapshot: AppVersionSnapshot } | null>(null);
  const isIncludedPath = !pathPrefixes?.length || pathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const enabled = isIncludedPath && !hiddenPaths?.includes(pathname) && isContentAppVersion(initialVersion);
  const endpoints = appVersionEndpoints({ appId, versionEndpoint, realtimeConfigEndpoint });
  const resourceKey = JSON.stringify([appId, endpoints.version, endpoints.realtime, initialVersion]);
  const publishUrl = publishEndpoint ?? endpoints.version;

  useEffect(() => {
    if (!enabled) return;
    return subscribeToAppVersion({ appId, versionEndpoint: endpoints.version, realtimeConfigEndpoint: endpoints.realtime }, (snapshot) => {
      setLatest({ key: resourceKey, snapshot });
    });
  }, [appId, enabled, endpoints.realtime, endpoints.version, resourceKey]);

  useEffect(() => {
    if (!enabled) return;
    void publishAppVersionOnce(appId, initialVersion, publishUrl);
  }, [appId, enabled, initialVersion, publishUrl]);

  const update = latest?.key === resourceKey && latest.snapshot.app === appId && latest.snapshot.version !== initialVersion
    ? latest.snapshot : null;
  if (!enabled || !update) return null;

  return (
    <div className="app-version-notice" role="status" aria-live="polite">
      <div>
        <strong>新しい {appName} 版があります</strong>
        <span>現在 {initialShortVersion} / 最新 {update.shortVersion}</span>
      </div>
      <button type="button" onClick={() => window.location.reload()}>
        <RefreshCw size={16} />
        更新
      </button>
    </div>
  );
}
