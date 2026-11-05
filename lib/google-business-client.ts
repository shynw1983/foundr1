import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { GbpPeriod } from './google-business-hours-policy';

export const gbpScope = 'https://www.googleapis.com/auth/business.manage';
export const gbpCallbackPath = '/api/os/google-business/oauth';
export function googleBusinessConfig() {
  const clientId = process.env.GOOGLE_BUSINESS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_BUSINESS_REDIRECT_URI;
  const rawKey = process.env.GOOGLE_BUSINESS_TOKEN_KEY;
  if (!clientId || !clientSecret || !redirectUri || !rawKey || !/^[a-f0-9]{64}$/i.test(rawKey)) throw new Error('Google 連携の環境設定が必要です。');
  const url = new URL(redirectUri);
  if (url.pathname !== gbpCallbackPath || (url.protocol !== 'https:' && url.hostname !== 'localhost')) throw new Error('Google 連携の環境設定が必要です。');
  return { clientId, clientSecret, redirectUri, key: Buffer.from(rawKey, 'hex') };
}
export function sealGoogleSecret(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', googleBusinessConfig().key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}
export function openGoogleSecret(value: string, context: string) {
  const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', googleBusinessConfig().key, iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
export async function exchangeGoogleToken(fields: Record<string, string>) {
  const config = googleBusinessConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, client_id: config.clientId, client_secret: config.clientSecret }),
    signal: AbortSignal.timeout(10000), cache: 'no-store'
  });
  const body = await response.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!response.ok || !body.access_token) throw new Error(`Google の認証を確認してください（${response.status}）。`);
  return body;
}
export async function googleAccessToken(storeId: string, ciphertext: string) {
  const token = await exchangeGoogleToken({ grant_type: 'refresh_token', refresh_token: openGoogleSecret(ciphertext, storeId) });
  return token.access_token!;
}
export type GoogleLocation = { name: string; title: string; storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string }; regularHours?: { periods?: unknown[] }; specialHours?: { specialHourPeriods?: GbpPeriod[] }; metadata?: { hasPendingEdits?: boolean } };
export async function googleRequest<T>(token: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? 'PATCH' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Google API の応答を確認してください（${response.status}）。`);
  return await response.json() as T;
}
const locationApi = 'https://mybusinessbusinessinformation.googleapis.com/v1/';
export async function listGoogleLocations(token: string) {
  const locations: GoogleLocation[] = [];
  let pageToken = '';
  do {
    const accounts = await googleRequest<{ accounts?: Array<{ name: string }>; nextPageToken?: string }>(token, `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20&pageToken=${encodeURIComponent(pageToken)}`);
    for (const account of accounts.accounts ?? []) {
      if (!/^accounts\/\d+$/.test(account.name)) continue;
      let locationPage = '';
      do {
        const result = await googleRequest<{ locations?: GoogleLocation[]; nextPageToken?: string }>(token, `${locationApi}${account.name}/locations?readMask=name,title,storefrontAddress&pageSize=100&pageToken=${encodeURIComponent(locationPage)}`);
        locations.push(...result.locations ?? []);
        locationPage = result.nextPageToken ?? '';
      } while (locationPage);
    }
    pageToken = accounts.nextPageToken ?? '';
  } while (pageToken);
  return [...new Map(locations.map(location => [location.name, location])).values()];
}
export function getGoogleLocation(token: string, name: string) {
  if (!/^locations\/\d+$/.test(name)) throw new Error('Google の店舗を選択してください。');
  return googleRequest<GoogleLocation>(token, `${locationApi}${name}?readMask=name,title,regularHours,specialHours,metadata`);
}
export function patchGoogleHours(token: string, name: string, periods: GbpPeriod[]) {
  if (!/^locations\/\d+$/.test(name)) throw new Error('Google の店舗を選択してください。');
  return googleRequest<GoogleLocation>(token, `${locationApi}${name}?updateMask=specialHours`, { specialHours: { specialHourPeriods: periods } });
}
