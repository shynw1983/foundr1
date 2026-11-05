"use client";

import { usePathname } from "next/navigation";
import { StoreNativeOrderNotifier } from "./StoreNativeOrderNotifier";
import { StoreInventorySyncStatus } from "./StoreInventorySyncStatus";
import { StorePrintStation } from "./StorePrintStation";
import { StoreHqAlert } from "./StoreHqAlert";
import { canReceiveHqAlert } from "../../../lib/store-hq-alert-policy";
import { StoreVersionNotice } from "./StoreVersionNotice";

export function StoreOperationalServices({ fullWorkbench, initialVersion, initialShortVersion }: {
  fullWorkbench: boolean;
  initialVersion: string;
  initialShortVersion: string;
}) {
  const pathname = usePathname();
  // A direct debug-page load must never briefly mount live order/print feeds
  // while the client is still resolving its route.
  if (!pathname || ["/store/pos/debug", "/store/pos/customer-display/debug"].includes(pathname.replace(/\/+$/, ""))) return null;

  return <>
    {fullWorkbench && canReceiveHqAlert(pathname) ? <StoreHqAlert /> : null}
    <StoreVersionNotice initialVersion={initialVersion} initialShortVersion={initialShortVersion} />
    {fullWorkbench ? <><StoreNativeOrderNotifier /><StorePrintStation /><StoreInventorySyncStatus /></> : null}
  </>;
}
