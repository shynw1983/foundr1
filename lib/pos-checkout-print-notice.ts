import type { PosPrintDocumentQueue } from './pos-print-document-contract';

/** Read-only status for exactly the completed sale; never infers success from an incomplete queue. */
export function posCheckoutPrintStatus(orderId: string, count: number, queue: PosPrintDocumentQueue | null, queueOrderId: string, readError = '') {
  if (count === 0) return '会計済み・印刷なし';
  if (readError) return '会計済み・印刷状況を確認してください';
  if (!queue || queueOrderId !== orderId || queue.hasMore) return '会計済み・印刷状況を確認中';
  const documents = queue.documents.filter(document => document.orderId === orderId);
  if (!documents.length || documents.length !== count) return '会計済み・印刷状況を確認中';
  if (documents.some(document => document.state === 'uncertain')) return '会計済み・印刷状況を確認してください';
  if (documents.some(document => document.state === 'pending' || document.state === 'sending')) return '会計済み・印刷待ち';
  if (documents.some(document => document.state === 'cancelled')) return '会計済み・取消済みの伝票があります';
  if (documents.some(document => document.state === 'sent')) return '会計済み・伝票送信済み';
  return '会計済み・印刷なし';
}
