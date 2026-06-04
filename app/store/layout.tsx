import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Foundr1 Store",
  description: "店舗スタッフ向けオペレーション画面",
  manifest: "/manifest-store.webmanifest",
  appleWebApp: {
    title: "Foundr1 Store"
  }
};

export default function StoreLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
