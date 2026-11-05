import {createHash} from 'node:crypto';

export type MenuRecoveryMode = 'inspect' | 'restore_hidden' | 'verify_release';
export type MenuRecoveryAction = 'inspect' | 'restore_hidden' | 'verify_release' | 'retry';
export type MenuRecoveryView = {
  jobId: string; platform: string; supported: boolean;
  status: 'idle' | 'checking' | 'ready' | 'repairing' | 'verified' | 'blocked' | 'unknown';
  code?: string;
  target?: {name: string; kind: 'item' | 'option'; parentName?: string};
  command?: {id: string; status: string; mode: string; error?: string};
  inspection?: {
    id: string; at: string; expiresAt: string;
    native: {name: string; price?: number; hidden?: boolean; isAvailable?: boolean; nativeStatus?: string; parentNames?: string[]};
    hold: 'unavailable' | 'available' | 'follow' | null;
    latestOperation?: {at: string; isAvailable: boolean; status: string};
    blockers: string[];
  };
  plan?: {mode: 'restore_hidden' | 'verify_release' | 'retry'; token: string; expiresAt: string};
  continuation?: {id: string; status: string; code?: string};
};
export type RecoveryRecord = Record<string, any>;
export function recoveryRecord(value: unknown): RecoveryRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecoveryRecord : {};
}
export function recoverySourceKey(error: string) {
  return error.match(/^(?:uber_authority|uber_publication)_draft_exposed:((?:option:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+)|(?:item:[A-Za-z0-9_-]+))$/)?.[1] ?? '';
}
export function selectRecoveryTarget(payload: RecoveryRecord, error: string) {
  const key = recoverySourceKey(error), targets = Array.isArray(payload.targets) ? payload.targets.map(recoveryRecord) : [];
  const matches = targets.filter(target => target.sourceKey === key && ['item', 'option'].includes(target.kind));
  if (!key || matches.length !== 1) return null;
  const target = matches[0];
  if (target.archived || target.quarantined || !target.targetId || typeof target.name !== 'string' || !target.name.trim()) return null;
  const mappings = Array.isArray(target.mappings) ? target.mappings.map(recoveryRecord) : [];
  // This first recovery flow addresses one proven new counterpart. Multiple
  // occurrences require an explicit target decision, never the first candidate.
  if (mappings.length !== 1 || mappings[0].created !== true || !mappings[0].externalId) return null;
  const parents = targets.filter(parent => parent.targetId === target.parentId && parent.kind === (target.kind === 'option' ? 'option_group' : 'category'));
  return {target, mapping: mappings[0], parentName: parents.length === 1 ? String(parents[0].name ?? '') : ''};
}
export function recoveryFingerprint(value: unknown) {
  const stable = (item: any): any => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, stable(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function recoveryNative(result: unknown) {
  const row = recoveryRecord(recoveryRecord(result).inspection);
  return {
    name: typeof row.name === 'string' ? row.name.slice(0, 500) : '',
    ...(typeof row.price === 'number' && Number.isSafeInteger(row.price) ? {price: row.price} : {}),
    ...(typeof row.hidden === 'boolean' ? {hidden: row.hidden} : {}),
    ...(typeof row.isAvailable === 'boolean' ? {isAvailable: row.isAvailable} : {}),
    ...(typeof row.nativeStatus === 'string' ? {nativeStatus: row.nativeStatus.slice(0, 60)} : {}),
    ...(Array.isArray(row.parentNames) ? {parentNames: row.parentNames.filter((name: unknown): name is string => typeof name === 'string').slice(0, 8).map((name: string) => name.slice(0, 500))} : {})
  };
}
export function validRecoveryEnvelope(result: unknown, payload: RecoveryRecord) {
  const value = recoveryRecord(result), recovery = recoveryRecord(payload.recovery);
  const selection = selectRecoveryTarget(payload, String(recovery.failedJobError ?? ''));
  if (!selection) return false;
  const row = recoveryRecord(value.inspection);
  return value.recoveryVersion === 1 && value.failedJobId === recovery.failedJobId && value.mode === recovery.mode
    && value.sourceId === payload.sourceId && value.storeId === payload.storeId && value.brandId === payload.brandId
    && value.platformKey === payload.platformKey && String(value.merchantId) === String(payload.merchantId)
    && value.revision === payload.revision && value.sourceKey === recovery.sourceKey && value.targetId === selection.target.targetId
    && value.kind === selection.target.kind && String(value.externalId) === String(recovery.externalId)
    && String(value.externalParentId ?? '') === String(recovery.externalParentId ?? '');
}

export function validRecoveryInspection(result: unknown, payload: RecoveryRecord) {
  if (!validRecoveryEnvelope(result,payload)) return false;
  const selected = selectRecoveryTarget(payload,String(payload.recovery?.failedJobError??''))!;
  const row = recoveryRecord(recoveryRecord(result).inspection);
  return row.found===true && row.identityVerified===true && row.name===selected.target.name
    && (selected.target.price===null||row.price===selected.target.price)
    && typeof row.hidden==='boolean' && typeof row.isAvailable==='boolean';
}
