import type { PosPrintPayload } from "./pos-printer";
import type { RelayOwner } from "./store-relay-policy";

export const POS_PRINT_DOCUMENT_VERSION = 1 as const;
export type PosPrintMode = "auto" | "deferred" | "none";
export type PosPrintDocumentKind = "kitchen" | "finishing" | "pickup" | "receipt";
export type PosPrintDocumentState = "not_requested" | "pending" | "sending" | "sent" | "uncertain" | "cancelled";
export type PosPrintDocumentTransport = "direct" | "relay";

export type PosPrintDocument = {
  id: string;
  orderId: string;
  itemId: string | null;
  kind: PosPrintDocumentKind;
  sequence: number;
  copyNumber: number;
  pickupCode: string;
  label: string;
  createdAt: string;
  orderCreatedAt: string;
  state: PosPrintDocumentState;
  error: string;
  eligible: boolean;
  blockedReason: string;
  revision: number;
  transport: PosPrintDocumentTransport | null;
};

export type PosPrintDocumentQueue = {
  version: typeof POS_PRINT_DOCUMENT_VERSION;
  selectedStoreId: string;
  documents: PosPrintDocument[];
  summary: { pendingDocuments: number; pendingOrders: number; needsReview: number; sendingDocuments: number };
  hasMore: boolean;
  cursor: string | null;
  relay: { available: boolean; online: boolean; stationId?: string };
  serverNow: string;
};

export type PosPrintDocumentMutation = {
  action: "claim" | "ack" | "confirmPrinted" | "voidIneligible";
  storeId: string;
  documentId: string;
  operationId: string;
  expectedRevision?: number;
  transport?: PosPrintDocumentTransport;
  relayOwner?: RelayOwner;
  initialCheckout?: boolean;
  checkoutRequestId?: string;
  reprint?: boolean;
  physicalConfirmed?: boolean;
  claimToken?: string;
  result?: "sent" | "uncertain";
  error?: string;
};

export type PosPrintDocumentClaim = {
  document: PosPrintDocument;
  transport: PosPrintDocumentTransport;
  claimToken?: string;
  payload?: PosPrintPayload;
  shouldPrint: boolean;
  queued?: boolean;
  alreadyDone?: boolean;
};

export type PosCheckoutPrintDocuments = {
  version: typeof POS_PRINT_DOCUMENT_VERSION;
  orderId: string;
  mode: PosPrintMode;
  documentCount: number;
  pendingCount: number;
};
