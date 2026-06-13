import type { Metadata } from "next";
import { Download } from "lucide-react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type ApkVersion = {
  app: string;
  title: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  buildType: string;
  fileName: string;
  downloadPath: string;
  sizeBytes: number;
  builtAt: string;
  gitCommit: string;
};

const appOrder = ["store", "os", "member", "staff"];

export const metadata: Metadata = {
  title: "Foundr1 APK Downloads",
  description: "Foundr1 Android APK downloads"
};

function readVersion(app: string) {
  const json = readFileSync(join(process.cwd(), "public", "downloads", app, "version.json"), "utf8");
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

export default function DownloadsPage() {
  const versions = appOrder.map(readVersion);

  return (
    <main className="apk-downloads-shell">
      <section className="apk-downloads-heading">
        <p className="eyebrow">Foundr1</p>
        <h1>APK Downloads</h1>
        <p>各Androidアプリの最新版APKをここからダウンロードできます。</p>
      </section>

      <section className="apk-downloads-grid">
        {versions.map((apk) => (
          <article className="apk-download-card" key={apk.app}>
            <div>
              <h2>{apk.title}</h2>
              <p>{apk.packageName}</p>
            </div>
            <dl>
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
                <dt>Commit</dt>
                <dd>{apk.gitCommit}</dd>
              </div>
            </dl>
            <a className="primary-button apk-download-card-button" href={apk.downloadPath} download={apk.fileName}>
              <Download size={18} />
              ダウンロード
            </a>
          </article>
        ))}
      </section>
    </main>
  );
}
