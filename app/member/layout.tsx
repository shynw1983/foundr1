import type { Metadata, Viewport } from "next";
import { MemberLanguageProvider } from "../../components/member/MemberLanguageProvider";

export const metadata: Metadata = {
  title: "Foundr1 MEMBER",
  description: "Foundr1 ブランド共通の会員証アプリ",
  manifest: "/manifest-member.webmanifest",
  other: {
    google: "notranslate"
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Foundr1 MEMBER"
  },
  icons: {
    icon: [
      { url: "/icons/foundr1-member-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/foundr1-member-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: "/icons/foundr1-member-apple-touch.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#202a36"
};

export default function MemberLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <MemberLanguageProvider>
      <div className="notranslate" translate="no">
        {children}
      </div>
    </MemberLanguageProvider>
  );
}
