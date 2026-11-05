import generated from "./generated/app-web-versions.json";
import { isContentAppVersion, type AppVersionScope } from "./app-version-protocol";

export function getAppVersion(app: AppVersionScope = "os") {
  if (process.env.NODE_ENV !== "production") return "local";
  const version = generated.versions[app];
  if (generated.schema !== 1 || !isContentAppVersion(version)) {
    throw new Error(`Missing content version for ${app}; generate application versions before building.`);
  }
  return version;
}

export function getShortAppVersion(version = getAppVersion()) {
  return version === "local" ? version : version.slice(0, 7);
}
