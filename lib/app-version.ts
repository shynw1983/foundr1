export function getAppVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    "local"
  );
}

export function getShortAppVersion(version = getAppVersion()) {
  return version === "local" ? version : version.slice(0, 7);
}
