import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Foundr1 MEMBER",
  description: "Foundr1 ブランド共通の会員証アプリ",
  manifest: "/manifest-member.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Foundr1 MEMBER"
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
  themeColor: "#ffffff"
};

export default function MemberLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
