import { start } from "workflow/api";
import type { CustomerOrderRow } from "./customer-orders";
import { ensurePreparationDueAlertEvent, recordAlertWorkflowRun } from "./store-order-alert-events";
import { storeOrderPreparationReminderWorkflow } from "../workflows/store-order-preparation-reminder";

export async function scheduleStoreOrderPreparationReminder(order: CustomerOrderRow | null) {
  if (!order) return null;
  const event = await ensurePreparationDueAlertEvent(order);
  if (!event || event.status !== "pending" || event.workflowRunId) return event;

  const run = await start(storeOrderPreparationReminderWorkflow, [event.id, event.dueAt]);
  await recordAlertWorkflowRun(event.id, run.runId);
  return { ...event, workflowRunId: run.runId };
}
