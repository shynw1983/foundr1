import { handleDemandApi } from "../../../../lib/replenishment-demand-api";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleDemandApi(request, true);
export const POST = (request: Request) => handleDemandApi(request, true, true);
