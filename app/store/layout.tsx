import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { authCookieName,readSessionToken } from "../../lib/auth";
import { canUseFullStoreWorkbench } from "../../lib/store-inventory-policy";
import { getAppVersion, getShortAppVersion } from "../../lib/app-version";
import { StoreNativeOrderNotifier } from "./components/StoreNativeOrderNotifier";
import { StoreInventorySyncStatus } from "./components/StoreInventorySyncStatus";
import { StorePrintStation } from "./components/StorePrintStation";
import { StoreVersionNotice } from "./components/StoreVersionNotice";
import "./store-responsive.css";

export const metadata: Metadata = {
  title: "Foundr1 STORE",
  description: "店舗スタッフ向けオペレーション画面",
  manifest: "/manifest-store.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Foundr1 STORE"
  },
  icons: {
    icon: [
      { url: "/icons/foundr1-store-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/foundr1-store-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: "/icons/foundr1-store-apple-touch.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#202a36"
};

export default async function StoreLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const version = getAppVersion();
  // Rendering only: API routes still check the active DB session and scope.
  // Restricted personal Store users do not start unrelated order/print feeds.
  const cookieStore=await cookies();
  const fullWorkbench=canUseFullStoreWorkbench(readSessionToken(cookieStore.get(authCookieName)?.value)?.role??"");
  return (
    <>
      <StoreVersionNotice initialVersion={version} initialShortVersion={getShortAppVersion(version)} />
      {fullWorkbench ? <><StoreNativeOrderNotifier /><StorePrintStation /><StoreInventorySyncStatus /></> : null}
      {children}
    </>
  );
}
