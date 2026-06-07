import type { Metadata } from "next";
import { getAppVersion, getShortAppVersion } from "../../lib/app-version";
import { StoreVersionNotice } from "./components/StoreVersionNotice";

export const metadata: Metadata = {
  title: "Foundr1 STORE",
  description: "店舗スタッフ向けオペレーション画面",
  manifest: "/manifest-store.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
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

export default function StoreLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const version = getAppVersion();
  return (
    <>
      <StoreVersionNotice initialVersion={version} initialShortVersion={getShortAppVersion(version)} />
      {children}
    </>
  );
}
