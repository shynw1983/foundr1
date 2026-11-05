import type { StoreInventoryOperator } from "./store-inventory-access";
import type { ReplenishmentSource } from "./replenishment-policy";

export type ReplenishmentDemandStatus = "open" | "reviewing" | "deferred" | "ordered" | "resolved" | "dismissed";
export type ReplenishmentDemandProduct = { id: string; name: string; unit: string; isOrderable: boolean };
export type ReplenishmentDemandEvent = {
  id: string; kind: string; actorName: string | null; note: string; quantity: number | null; unit?: string | null; shortageStatus?: "low_stock" | "unavailable" | null; createdAt: string;
};
export type ReplenishmentDemandOrder = {
  orderId: string; orderNo: string; itemId: string; status: string; requestedQuantity: number; unit: string;
  actualQuantity: number | null; actualUnit: string | null; receivedQuantity: number;
};
export type ReplenishmentDemand = {
  id: string; storeId: string; storeName: string; product: ReplenishmentDemandProduct;
  status: ReplenishmentDemandStatus; version: number; quantity: number | null; unit: string;
  note: string; deferredUntil: string | null; createdAt: string; updatedAt: string;
  inventory: Array<{ id: string; locationName: string; quantity: number | null; countUnit: string; safetyStock: number | null; lastCountedAt: string | null; quickStatus: string | null; quickCheckedAt: string | null }>;
  openOrders: ReplenishmentDemandOrder[];
  sources: ReplenishmentSource[]; events: ReplenishmentDemandEvent[]; orders: ReplenishmentDemandOrder[];
  openItemIds: string[];
  progress: "reported" | "reviewing" | "deferred" | "purchasing" | "awaiting_receipt" | "partial_received" | "received" | "needs_review" | "resolved" | "dismissed";
};
export type ReplenishmentDemandResponse = {
  stores: Array<{ id: string; name: string }>; storeId: string; demands: ReplenishmentDemand[];
  products: ReplenishmentDemandProduct[];
  operator: StoreInventoryOperator | null; canReport: boolean; canManage: boolean;
  buyers: Array<{ id: string; name: string }>;
};
export type ReplenishmentDemandReport = {
  action: "report"; storeId: string; productId: string; requestId: string; expectedOperatorId?: string;
  quantity?: number | null; unit: string; note: string; shortageStatus?: "low_stock" | "unavailable";
};
export type ReplenishmentDemandReview = {
  action: "review"; storeId: string; demandId: string; expectedVersion: number;
  status: ReplenishmentDemandStatus; quantity: number | null; unit: string; note: string; deferredUntil?: string | null;
};
export type ReplenishmentDemandCreateOrder = {
  action: "create_order"; storeId: string; requestId: string; expectedActorId: string; buyerId: string; deadline?: string; note?: string;
  additionalOrderConfirmed: boolean;
  items: Array<{ demandId: string; expectedVersion: number; quantity: number; unit: string; expectedOpenItemIds: string[] }>;
};
