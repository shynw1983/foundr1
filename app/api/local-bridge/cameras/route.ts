import { storeCameraHandlers } from "../../../../lib/store-cameras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = storeCameraHandlers.bridgeGet;
export const POST = storeCameraHandlers.bridgePost;
