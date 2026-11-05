/** Shared POS fulfillment wire protocol. Production remains in the existing task ledger. */
export type PosFulfillmentAction = "ready" | "handoff" | "recall" | "undo";
export type PosFulfillmentTask = {
  id: string;
  orderId: string;
  orderItemId: string;
  pickupCode: string;
  status: "waiting" | "ready";
  productionStatus: "new" | "preparing" | "ready";
  version: string;
  itemSummary: string;
  note: string;
  createdAt: string;
  readyAt: string;
  tableLabel: string;
  orderType: string;
  quantity: number;
};
export type PosFulfillmentUndo = {
  token: string;
  expiresAt: string;
  taskId: string;
  pickupCode: string;
  action: "ready" | "handoff";
  version: string;
};
export const posFulfillmentUndoSeconds = 15;
export const posBowlOrderStatusMessage = "この注文は料理ごとに操作してください。POS の提供管理またはキッチンで確認できます。";
