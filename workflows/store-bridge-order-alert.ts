import { sleep } from "workflow";
import { dispatchBridgeOrderPush } from "../lib/store-order-push";

async function dispatchStep(eventId: string, attempt: number) {
  "use step";
  return dispatchBridgeOrderPush(eventId, attempt);
}

export async function storeBridgeOrderAlertWorkflow(eventId: string, dueAt: string) {
  "use workflow";
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(new Date(new Date(dueAt).getTime() + attempt * 30_000));
    const result = await dispatchStep(eventId, attempt);
    if (result.stop) return;
  }
}
