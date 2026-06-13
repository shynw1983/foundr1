import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const appConfigs = {
  store: {
    title: "Foundr1 STORE",
    packageName: "jp.foundr1.store",
    legacyFileName: "foundr1-store-latest.apk"
  },
  os: {
    title: "Foundr1 OS",
    packageName: "jp.foundr1.os",
    legacyFileName: "foundr1-os-latest.apk"
  },
  member: {
    title: "Foundr1 MEMBER",
    packageName: "jp.foundr1.member",
    legacyFileName: "foundr1-member-latest.apk"
  },
  staff: {
    title: "Foundr1 STAFF",
    packageName: "jp.foundr1.staff",
    legacyFileName: "foundr1-staff-latest.apk"
  }
};

const flavor = process.argv[2];
const skipBuild = process.argv.includes("--skip-build");

if (!flavor || !appConfigs[flavor]) {
  console.error(`Usage: node scripts/publish-android-apk.mjs <${Object.keys(appConfigs).join("|")}> [--skip-build]`);
  process.exit(1);
}

const repoRoot = process.cwd();
const androidRoot = join(repoRoot, "Foundr1Android");
const gradleTask = `assemble${flavor[0].toUpperCase()}${flavor.slice(1)}Debug`;
const outputDir = join(androidRoot, "app", "build", "outputs", "apk", flavor, "debug");
const metadataPath = join(outputDir, "output-metadata.json");
const downloadsDir = join(repoRoot, "public", "downloads");
const appDownloadDir = join(downloadsDir, flavor);

if (!skipBuild) {
  execFileSync("./gradlew", [gradleTask], {
    cwd: androidRoot,
    stdio: "inherit"
  });
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
const element = metadata.elements?.[0];
if (!element?.outputFile) {
  throw new Error(`Cannot find APK output in ${metadataPath}`);
}

const sourceApk = join(outputDir, element.outputFile);
const targetFileName = "latest.apk";
const targetApk = join(appDownloadDir, targetFileName);
const legacyApk = join(downloadsDir, appConfigs[flavor].legacyFileName);

mkdirSync(appDownloadDir, { recursive: true });
copyFileSync(sourceApk, targetApk);
copyFileSync(sourceApk, legacyApk);

const apkBytes = readFileSync(sourceApk);
const apkStat = statSync(sourceApk);
const gitCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();

const version = {
  app: flavor,
  title: appConfigs[flavor].title,
  packageName: appConfigs[flavor].packageName,
  versionName: String(element.versionName ?? "0.0.0"),
  versionCode: Number(element.versionCode ?? 0),
  buildType: "debug",
  fileName: targetFileName,
  downloadPath: `/downloads/${flavor}/${targetFileName}`,
  legacyDownloadPath: `/downloads/${appConfigs[flavor].legacyFileName}`,
  sizeBytes: apkStat.size,
  sha256: createHash("sha256").update(apkBytes).digest("hex"),
  builtAt: new Date().toISOString(),
  gitCommit
};

writeFileSync(join(appDownloadDir, "version.json"), `${JSON.stringify(version, null, 2)}\n`);
console.log(`Published ${version.title} ${version.versionName} (${version.versionCode}) to ${version.downloadPath}`);
