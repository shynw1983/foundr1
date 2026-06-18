import type { Metadata, Viewport } from "next";
import { getAppVersion, getShortAppVersion } from "../../lib/app-version";
import { AppVersionNotice } from "../os/components/AppVersionNotice";
import { PrivacyConsentGate } from "../os/components/PrivacyConsentGate";

export const metadata: Metadata = {
  title: "Foundr1 STAFF",
  description: "スタッフ向け個人ワークアプリ",
  manifest: "/manifest-staff.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Foundr1 STAFF"
  },
  icons: {
    icon: [
      { url: "/icons/foundr1-staff-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/foundr1-staff-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: "/icons/foundr1-staff-apple-touch.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#202a36"
};

export default function StaffLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const version = getAppVersion();
  return (
    <>
      <AppVersionNotice appName="Staff" initialVersion={version} initialShortVersion={getShortAppVersion(version)} pathPrefixes={["/staff"]} />
      <PrivacyConsentGate />
      {children}
    </>
  );
}
