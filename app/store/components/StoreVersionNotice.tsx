"use client";

import { AppVersionNotice } from "../../os/components/AppVersionNotice";

type StoreVersionNoticeProps = {
  initialVersion: string;
  initialShortVersion: string;
};

export function StoreVersionNotice({ initialVersion, initialShortVersion }: StoreVersionNoticeProps) {
  return (
    <AppVersionNotice
      appId="store"
      appName="Store"
      initialVersion={initialVersion}
      initialShortVersion={initialShortVersion}
      pathPrefixes={["/store"]}
      hiddenPaths={["/store/pos/customer-display"]}
      versionEndpoint="/api/store/version"
      publishEndpoint="/api/store/version"
    />
  );
}
