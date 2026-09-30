import { after } from "next/server";
import { authorizeStoreDevices, deviceJson as json } from "../../../../../lib/store-device-access";
import { createStoreSceneRun, executeStoreSceneRun, getStoreSceneRun, getStoreScenes, saveStoreScenes } from "../../../../../lib/store-device-scenes";
import { StoreDeviceError } from "../../../../../lib/store-devices";
import { sceneUuid } from "../../../../../lib/store-scene-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;
const failure = (error: unknown) => error instanceof StoreDeviceError ? json({ error: error.message }, error.status) : json({ error: "シーンを処理できません。再読込して結果を確認してください。" }, 503);
const badOrigin = (request: Request) => Boolean(request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), access = await authorizeStoreDevices(url.searchParams.get("storeId"));
    if (access.error) return access.error;
    const run = url.searchParams.get("run");
    if (run && !sceneUuid.test(run)) return json({ error: "操作内容を確認してください。" }, 400);
    if (run) return json({ run: await getStoreSceneRun(access.storeId!, run) });
    return json(await getStoreScenes(access.storeId!));
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  if (badOrigin(request)) return json({ error: "不正なリクエスト元です。" }, 403);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "シーン名と操作内容を確認してください。" }, 400);
  try {
    const access = await authorizeStoreDevices(body.storeId);
    if (access.error) return access.error;
    return json(await saveStoreScenes(access.storeId!, access.session!.id, body.scenes, body.revision));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (badOrigin(request)) return json({ error: "不正なリクエスト元です。" }, 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.sceneId !== "string" || !sceneUuid.test(body.sceneId) || typeof body.requestId !== "string" || !sceneUuid.test(body.requestId)
    || typeof body.revision !== "string" || body.confirmed !== true) return json({ error: "操作内容を確認してください。" }, 400);
  try {
    const access = await authorizeStoreDevices(body.storeId);
    if (access.error) return access.error;
    const result = await createStoreSceneRun(access.storeId!, access.session!.id, body.sceneId, body.requestId, body.revision, body.allowUnlock === true);
    if (result.created) after(async () => {
      try { await executeStoreSceneRun(access.storeId!, result.run.id); }
      catch { console.error("store_scene_execution_interrupted", { storeId: access.storeId, runId: result.run.id }); }
    });
    return json({ run: result.run }, result.created ? 202 : 200);
  } catch (error) { return failure(error); }
}
