import type { PosPrintPayload } from "./pos-printer";

export type PosPrintJob = {
  id: string;
  storeId: string;
  orderId: string;
  clientOrderId?: string;
  label: string;
  kind?: "kitchen" | "finishing" | "pickup" | "receipt";
  itemId?: string;
  offline?: boolean;
  createdAt?: string;
  sequence?: number;
  payload: PosPrintPayload;
  state: "pending" | "sending" | "sent" | "failed";
  error: string;
};

// Persist each document before sending. An interrupted/uncertain send is never retried automatically.
export async function runPosPrintJobs(
  jobs: PosPrintJob[],
  save: (job: PosPrintJob) => Promise<unknown>,
  print: (payload: PosPrintPayload) => Promise<{ ok: boolean; error?: string }>
) {
  for (const job of jobs) {
    if (job.state === "sent") continue;
    if (job.state === "sending" || job.state === "failed") break;
    job.state = "sending";
    await save(job);
    let result: { ok: boolean; error?: string };
    try { result = await print(job.payload); }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "印刷結果を確認できません。" }; }
    job.state = result.ok ? "sent" : "failed";
    job.error = result.error || "";
    await save(job);
    if (!result.ok) break;
  }
  return jobs;
}
