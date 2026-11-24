import type { ReactNode } from "react";
import { getAppVersion, getShortAppVersion } from "../../lib/app-version";
import { AppVersionNotice } from "./components/AppVersionNotice";
import "./os-interface.css";
import "./os-editorial.css";

export default function OsLayout({ children }: { children: ReactNode }) {
  const version = getAppVersion("os");
  return (
    <div className="os-interface os-editorial-root" data-os-ui="editorial">
      <AppVersionNotice
        appId="os"
        appName="OS"
        initialVersion={version}
        initialShortVersion={getShortAppVersion(version)}
        pathPrefixes={["/os"]}
      />
      {children}
    </div>
  );
}
