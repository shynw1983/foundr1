export const hqAlertUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const hqAlertMessageLimit = 1000;
export type HqAlert = {
  id: string; storeId: string; message: string; senderName: string; createdAt: string;
  deliveredAt: string | null; readAt: string | null; readerName: string | null; readerDevice: string | null;
};
export function canSendHqAlert(role: string) { return role === 'owner' || role === 'manager'; }
export function canReceiveHqAlert(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (/^\/store\/pos\/(customer-display|debug)(\/|$)/.test(path)) return false;
  return ['/store', '/store/pos', '/store/orders', '/store/menu', '/store/inventory', '/store/replenishment', '/store/receiving', '/store/procedures', '/store/sns'].some(p => path === p || (p !== '/store' && path.startsWith(p + '/')));
}
export function parseHqAlertDraft(value: unknown) {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (typeof v.storeId !== 'string' || !hqAlertUuid.test(v.storeId) || typeof v.requestId !== 'string' || !hqAlertUuid.test(v.requestId)) return null;
  if (typeof v.message !== 'string') return null;
  const message = v.message.trim();
  if (!message || message.length > hqAlertMessageLimit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message)) return null;
  return { storeId: v.storeId, requestId: v.requestId, message };
}
export function hqAlertDeviceLabel(userAgent: string) {
  const device = /iPad|Macintosh.*Mobile/.test(userAgent) ? 'iPad' : /iPhone/.test(userAgent) ? 'iPhone' : /Android/.test(userAgent) ? 'Android' : 'PC';
  const browser = /wv\)|; wv|Foundr1/.test(userAgent) ? 'Store App' : /Edg\//.test(userAgent) ? 'Edge' : /Chrome|CriOS/.test(userAgent) ? 'Chrome' : /Safari/.test(userAgent) ? 'Safari' : 'Web';
  return `${device} · ${browser}`;
}
export function hqAlertChannel(storeId: string) { return `private-store-hq-alerts-${storeId}`; }
