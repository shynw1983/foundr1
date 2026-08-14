import { sleep } from "workflow";
import { dispatchPreparationDueAlert } from "../lib/store-order-alert-events";

async function dispatchPreparationDueAlertStep(eventId: string) {
  "use step";
  return dispatchPreparationDueAlert(eventId);
}

export async function storeOrderPreparationReminderWorkflow(eventId: string, dueAt: string) {
  "use workflow";
  await sleep(new Date(dueAt));
  return dispatchPreparationDueAlertStep(eventId);
}
