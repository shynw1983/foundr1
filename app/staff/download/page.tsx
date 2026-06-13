import type { Metadata } from "next";
import { Download, ShieldCheck, Smartphone } from "lucide-react";

const apk = {
  href: "/downloads/foundr1-staff-latest.apk",
  fileName: "foundr1-staff-latest.apk",
  versionName: "0.1.0",
  versionCode: 1,
  packageName: "jp.foundr1.staff",
  updatedAt: "2026-06-13",
  sizeLabel: "46 KB"
};

export const metadata: Metadata = {
  title: "Foundr1 STAFF APK",
  description: "Foundr1 STAFF Android APK download"
};

export default function StaffDownloadPage() {
  return (
    <main className="staff-download-shell">
      <section className="staff-download-panel">
        <img className="staff-download-icon" src="/icons/foundr1-staff-192.png" alt="" aria-hidden="true" />
        <div className="staff-download-heading">
          <p className="eyebrow">Foundr1 STAFF</p>
          <h1>Android APK</h1>
          <p>最新版のスタッフ用アプリをダウンロードできます。</p>
        </div>

        <a className="primary-button staff-download-button" href={apk.href} download={apk.fileName}>
          <Download size={18} />
          APKをダウンロード
        </a>

        <dl className="staff-download-meta">
          <div>
            <dt>バージョン</dt>
            <dd>{apk.versionName} ({apk.versionCode})</dd>
          </div>
          <div>
            <dt>更新日</dt>
            <dd>{apk.updatedAt}</dd>
          </div>
          <div>
            <dt>サイズ</dt>
            <dd>{apk.sizeLabel}</dd>
          </div>
          <div>
            <dt>パッケージ</dt>
            <dd>{apk.packageName}</dd>
          </div>
        </dl>

        <div className="staff-download-notes">
          <div>
            <Smartphone size={18} />
            <span>Android端末で開いて、ダウンロード後にインストールしてください。</span>
          </div>
          <div>
            <ShieldCheck size={18} />
            <span>端末が確認を求めた場合は、このアプリのインストールを許可してください。</span>
          </div>
        </div>

        <a className="text-button staff-download-back" href="/staff">
          STAFFホームへ
        </a>
      </section>
    </main>
  );
}
