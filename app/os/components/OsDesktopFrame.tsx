"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { OsEditorialSidebar } from "./OsEditorialSidebar";
import { canonicalNavItems, usePermittedNavModules } from "./OsNavList";

const STANDALONE_PATHS = [
  "/os/login",
  "/os/logout",
  "/os/store-terminal-login",
  "/os/privacy-consent"
];

export function OsDesktopFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const permittedModules = usePermittedNavModules(canonicalNavItems);

  const isStandalone = STANDALONE_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div className="os-ed-frame">
      <OsEditorialSidebar modules={permittedModules} />
      <div className="os-ed-frame-main">{children}</div>
    </div>
  );
}
