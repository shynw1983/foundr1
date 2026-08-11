import { POST as handleBridgeEvent } from "../../uber-eats/events/route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleBridgeEvent(request);
}
