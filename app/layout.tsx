import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "店舗仕入れ管理",
  description: "複数店舗・複数ブランド向け仕入れ管理システム"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
