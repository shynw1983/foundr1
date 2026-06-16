import type { Metadata } from "next";
import { Download, ShieldCheck, Smartphone } from "lucide-react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type ApkVersion = {
  title: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  buildType: string;
  fileName: string;
  downloadPath: string;
  latestDownloadPath?: string;
  sizeBytes: number;
  sha256: string;
  builtAt: string;
  gitCommit: string;
};

export const metadata: Metadata = {
  title: "Foundr1 STAFF APK",
  description: "Foundr1 STAFF Android APK download"
};

function getApkVersion() {
  const json = readFileSync(join(process.cwd(), "public", "downloads", "staff", "version.json"), "utf8");
  return JSON.parse(json) as ApkVersion;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBuildTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export default function StaffDownloadPage() {
  const apk = getApkVersion();

  return (
    <main className="staff-download-shell">
      <section className="staff-download-panel">
        <img className="staff-download-icon" src="/icons/foundr1-staff-192.png" alt="" aria-hidden="true" />
        <div className="staff-download-heading">
          <p className="eyebrow">Foundr1 STAFF</p>
          <h1>Android APK</h1>
          <p>最新版のスタッフ用アプリをダウンロードできます。</p>
        </div>

        <a
          className="primary-button staff-download-button"
          href={apk.latestDownloadPath ?? apk.downloadPath}
          download={apk.fileName}
        >
          <Download size={18} />
          APKをダウンロード
        </a>

        <dl className="staff-download-meta">
          <div>
            <dt>バージョン</dt>
            <dd>{apk.versionName} ({apk.versionCode})</dd>
          </div>
          <div>
            <dt>APKビルド</dt>
            <dd>{formatBuildTime(apk.builtAt)}</dd>
          </div>
          <div>
            <dt>サイズ</dt>
            <dd>{formatBytes(apk.sizeBytes)}</dd>
          </div>
          <div>
            <dt>パッケージ</dt>
            <dd>{apk.packageName}</dd>
          </div>
          <div>
            <dt>ビルド種別</dt>
            <dd>{apk.buildType}</dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>{apk.gitCommit}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd>{apk.sha256.slice(0, 12)}...</dd>
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
