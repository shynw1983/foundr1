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
const versionCodeArg = process.argv.find((arg) => arg.startsWith("--version-code="));
const versionNameArg = process.argv.find((arg) => arg.startsWith("--version-name="));

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
const appVersionPath = join(appDownloadDir, "version.json");

function readPreviousVersion() {
  try {
    return JSON.parse(readFileSync(appVersionPath, "utf8"));
  } catch {
    return null;
  }
}

function formatTokyoDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return { year, month, day };
}

function parseArgValue(arg) {
  return arg ? arg.slice(arg.indexOf("=") + 1).trim() : "";
}

const previousVersion = readPreviousVersion();
const previousVersionCode = Number(previousVersion?.versionCode ?? 0);
const nextVersionCode = Number(parseArgValue(versionCodeArg)) || Math.max(1, previousVersionCode + 1);
const dateKey = formatTokyoDateKey();
const nextVersionName = parseArgValue(versionNameArg) || `0.1.${nextVersionCode}`;

if (!skipBuild) {
  execFileSync("./gradlew", [gradleTask], {
    cwd: androidRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      FOUNDR1_ANDROID_VERSION_CODE: String(nextVersionCode),
      FOUNDR1_ANDROID_VERSION_NAME: nextVersionName
    }
  });
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
const element = metadata.elements?.[0];
if (!element?.outputFile) {
  throw new Error(`Cannot find APK output in ${metadataPath}`);
}

function formatDownloadFileName(flavor, versionName) {
  const safeVersion = String(versionName || "latest").replace(/[^0-9A-Za-z._-]/g, "-");
  return `foundr1-${flavor}-${safeVersion}.apk`;
}

const sourceApk = join(outputDir, element.outputFile);
const resolvedVersionName = String(element.versionName ?? nextVersionName);
const targetFileName = formatDownloadFileName(flavor, resolvedVersionName);
const targetApk = join(appDownloadDir, targetFileName);
const latestApk = join(appDownloadDir, "latest.apk");
const legacyApk = join(downloadsDir, appConfigs[flavor].legacyFileName);

mkdirSync(appDownloadDir, { recursive: true });
copyFileSync(sourceApk, targetApk);
copyFileSync(sourceApk, latestApk);
copyFileSync(sourceApk, legacyApk);

const apkBytes = readFileSync(sourceApk);
const apkStat = statSync(sourceApk);
const gitCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();
const gitSubject = execFileSync("git", ["log", "-1", "--pretty=%s"], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();

const version = {
  app: flavor,
  title: appConfigs[flavor].title,
  packageName: appConfigs[flavor].packageName,
  versionName: resolvedVersionName,
  versionCode: Number(element.versionCode ?? nextVersionCode),
  releaseLabel: `${dateKey.year}.${dateKey.month}.${dateKey.day}.${nextVersionCode}`,
  buildType: "debug",
  fileName: targetFileName,
  downloadPath: `/downloads/${flavor}/${targetFileName}`,
  latestDownloadPath: `/downloads/${flavor}/latest.apk`,
  legacyDownloadPath: `/downloads/${appConfigs[flavor].legacyFileName}`,
  sizeBytes: apkStat.size,
  sha256: createHash("sha256").update(apkBytes).digest("hex"),
  builtAt: new Date().toISOString(),
  gitCommit,
  gitSubject
};

writeFileSync(join(appDownloadDir, "version.json"), `${JSON.stringify(version, null, 2)}\n`);
console.log(`Published ${version.title} ${version.versionName} (${version.versionCode}) to ${version.downloadPath}`);
