import type { PosPrintPayload } from './pos-printer';
import type { PosPrintDocumentKind, PosPrintDocumentState } from './pos-print-document-contract';

/** Display-only projection. A preview deliberately has no printer destination or claim token. */
export type PosSavedPrintContent = Pick<PosPrintPayload,
  'jobType' | 'documentRole' | 'storeName' | 'printedAt' | 'kitchenTicketTemplate' | 'receiptTemplate' | 'order'> & {
  paperWidth: '80mm' | '58mm';
};
export type PosSavedPrintOrder = {
  orderId: string; pickupCode: string; createdAt: string; documentCount: number; memberLanguage: string;
};
export type PosSavedPrintDocument = {
  id: string; orderId: string; kind: PosPrintDocumentKind; sequence: number; copyNumber: number;
  pickupCode: string; state: PosPrintDocumentState; createdAt: string; content: PosSavedPrintContent;
};
export type PosSavedPrintPreviews = {
  selectedStoreId: string; orders: PosSavedPrintOrder[]; documents: PosSavedPrintDocument[];
  hasMoreDocuments: boolean; hasMoreOrders: boolean;
};
