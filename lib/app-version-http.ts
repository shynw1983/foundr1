import { appVersionChannel, appVersionEventName, isAppVersionScope, type AppVersionScope } from "./app-version-protocol.ts";

type VersionHttpDependencies = {
  getVersion: (app: AppVersionScope) => string;
  authorizePublish: (request: Request, app: AppVersionScope) => Promise<boolean>;
  publish: (app: AppVersionScope, version: string) => Promise<void>;
  realtime: () => { key: string; cluster: string };
};

const headers = { "Cache-Control": "no-store, max-age=0" };

function resolveApp(request: Request | undefined, fixedApp?: AppVersionScope): AppVersionScope | null {
  const values = request ? new URL(request.url).searchParams.getAll("app") : [];
  if (values.length > 1) return null;
  const value = values[0] ?? fixedApp ?? "os";
  if (!isAppVersionScope(value) || (fixedApp && value !== fixedApp)) return null;
  return value;
}

export function createAppVersionHandlers(dependencies: VersionHttpDependencies) {
  const snapshot = (app: AppVersionScope) => {
    const version = dependencies.getVersion(app);
    return { app, version, shortVersion: version === "local" ? version : version.slice(0, 7), checkedAt: new Date().toISOString() };
  };
  const invalidApp = () => Response.json({ error: "Invalid application." }, { status: 400, headers });

  return {
    get(request?: Request, fixedApp?: AppVersionScope) {
      const app = resolveApp(request, fixedApp);
      return app ? Response.json(snapshot(app), { headers }) : invalidApp();
    },
    async post(request: Request, fixedApp?: AppVersionScope) {
      const app = resolveApp(request, fixedApp);
      if (!app) return invalidApp();
      if (!await dependencies.authorizePublish(request, app)) {
        return Response.json({ error: "権限がありません。" }, { status: 403, headers });
      }
      const current = snapshot(app);
      try {
        await dependencies.publish(app, current.version);
      } catch {
        return Response.json({ error: "Version notification unavailable." }, { status: 503, headers });
      }
      return Response.json({ ok: true, ...current }, { headers });
    },
    realtime(request: Request) {
      const app = resolveApp(request);
      if (!app) return invalidApp();
      const { key, cluster } = dependencies.realtime();
      return Response.json({ app, key, cluster, versionChannel: appVersionChannel(app), eventName: appVersionEventName }, { headers });
    }
  };
}
