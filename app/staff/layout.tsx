import type { Metadata } from "next";
import { PrivacyConsentGate } from "../os/components/PrivacyConsentGate";

export const metadata: Metadata = {
  title: "Foundr1 STAFF",
  description: "スタッフ向け個人ワークアプリ",
  manifest: "/manifest-staff.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
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

export default function StaffLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <PrivacyConsentGate />
      {children}
    </>
  );
}
