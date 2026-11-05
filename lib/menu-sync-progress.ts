export type MenuSyncTargetKind = 'category' | 'option_group' | 'option' | 'item';
export type MenuSyncProgressContext = {
  sourceKey?: string;
  targetName?: string;
  targetKind?: MenuSyncTargetKind;
  parentName?: string;
  phase?: string;
  action?: string;
};
export type MenuSyncProgressResponse = MenuSyncProgressContext & {
  at: number;
  state?: string;
  occurrences?: number;
};
export type MenuSyncProgress = MenuSyncProgressContext & {
  telemetryVersion?: 2;
  completed?: number;
  total?: number;
  checkedTargets?: number;
  totalTargets?: number;
  skippedTargets?: number;
  contentChanges?: number;
  contentCompleted?: number;
  writeRequestsCompleted?: number;
  readRequestsCompleted?: number;
  startedAt?: number;
  phaseStartedAt?: number;
  requestStartedAt?: number;
  lastResponseAt?: number;
  updatedAt?: number;
  requestsCompleted?: number;
  requestState?: string;
  retry?: number;
  recent?: MenuSyncProgressResponse[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, limit = 500) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
}

function name(value: unknown, sourceKey: string) {
  const label = text(value);
  return label && label !== sourceKey
    && !/^(?:(?:item|option|option_group|category):|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|https?:\/\/)/i.test(label) ? label : '';
}

function counter(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function timestamp(value: unknown) {
  const at = counter(value);
  return at !== undefined && at <= 8.64e15 ? at : undefined;
}

function context(value: Record<string, unknown>, targets: Record<string, unknown>, includeOperation = false): MenuSyncProgressContext {
  const sourceKey = text(value.sourceKey) || (includeOperation ? text(record(value.authorityOperation).sourceKey) : '');
  const target = sourceKey && Object.prototype.hasOwnProperty.call(targets, sourceKey) ? record(targets[sourceKey]) : {};
  const targetName = name(value.targetName, sourceKey) || name(target.targetName, sourceKey);
  const kind = [value.targetKind, target.targetKind].find(kind => ['category', 'option_group', 'option', 'item'].includes(String(kind)));
  const parentName = name(value.parentName, sourceKey) || name(target.parentName, sourceKey);
  const phase = text(value.phase, 60);
  const action = text(value.action, 40);
  return {
    ...(sourceKey ? { sourceKey } : {}),
    ...(targetName ? { targetName } : {}),
    ...(kind ? { targetKind: kind as MenuSyncTargetKind } : {}),
    ...(parentName ? { parentName } : {}),
    ...(/^[a-z][a-z0-9_]*$/.test(phase) ? { phase } : {}),
    ...(['read_menu', 'read_item', 'read_category', 'read_options', 'read_availability', 'save'].includes(action) ? { action } : {})
  };
}

// The status endpoint exposes telemetry only. Durable creation/migration records,
// native request paths and command payloads stay outside this public projection.
// A global read has no source identity: never infer its target from prior history.
export function projectMenuSyncProgress(value: unknown, targetContexts: unknown = {}): MenuSyncProgress {
  const progress = record(value);
  const targets = record(targetContexts);
  const projected: MenuSyncProgress = context(progress, targets, true);
  if (progress.telemetryVersion === 2) projected.telemetryVersion = 2;
  for (const key of ['completed', 'total', 'requestsCompleted', 'retry', 'checkedTargets', 'totalTargets', 'skippedTargets', 'contentChanges', 'contentCompleted', 'writeRequestsCompleted', 'readRequestsCompleted'] as const) {
    const number = counter(progress[key]);
    if (number !== undefined) projected[key] = number;
  }
  for (const key of ['startedAt', 'phaseStartedAt', 'requestStartedAt', 'lastResponseAt', 'updatedAt'] as const) {
    const at = timestamp(progress[key]);
    if (at !== undefined) projected[key] = at;
  }
  if (['waiting', 'received', 'retrying', 'failed'].includes(String(progress.requestState))) projected.requestState = String(progress.requestState);
  if (Array.isArray(progress.recent)) projected.recent = progress.recent.slice(0, 10).flatMap(value => {
    const row = record(value);
    const at = timestamp(row.at);
    if (at === undefined) return [];
    const response: MenuSyncProgressResponse = { ...context(row, targets), at };
    if (['waiting', 'received', 'retrying', 'failed'].includes(String(row.state))) response.state = String(row.state);
    const occurrences = counter(row.occurrences);
    if (occurrences) response.occurrences = occurrences;
    return [response];
  });
  return projected;
}
