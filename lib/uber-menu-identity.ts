export type UberSourceIdentity = {
  sourceKey: string; kind: string; uberId: string; parentUberId: string;
  targetId: string; priceMode: 'manual' | 'automatic'; archived: boolean;
};

// Missing once is not a retirement. Preserve these IDs until an independent
// observation confirms deletion; moving the same target is handled upstream.
export function pendingUberRemovals<T extends {sourceKey:string;archived:boolean}>(missing:T[],confirmed:{sourceKey:string}[]) {
  const retired=new Set(confirmed.map(row=>row.sourceKey));
  return missing.filter(row=>!row.archived&&!retired.has(row.sourceKey));
}

// Names are not identity evidence. Moves require one current placement and one
// prior owner, so they preserve existing prices and stock without making copies.
export function resolveUberOptionMove(input: {
  uberId: string; parentUberId: string; currentParents: string[];
  sourceObjects: UberSourceIdentity[];
  legacyTargetIds: string[]; claimedTargetIds: string[];
}): (UberSourceIdentity & { movedFromSourceKey: string }) | { targetId: string } | null {
  const current = new Set(input.currentParents);
  const previous = input.sourceObjects.filter(row => row.kind === 'option'
    && row.uberId === input.uberId && !current.has(row.parentUberId));
  const candidates = [...new Set([
    ...previous.map(row => row.targetId), ...input.legacyTargetIds
  ])].filter(id => !input.claimedTargetIds.includes(id));
  if (!candidates.length) return null;
  if (current.size !== 1 || !current.has(input.parentUberId) || candidates.length !== 1) {
    throw new Error(`uber_source_move_ambiguous:${input.uberId}`);
  }
  const targetId = candidates[0];
  const owner = input.sourceObjects.find(row => row.kind === 'option' && row.targetId === targetId);
  if (owner && (owner.uberId !== input.uberId || current.has(owner.parentUberId))) {
    throw new Error(`uber_source_move_owner_conflict:${input.uberId}`);
  }
  return owner ? { ...owner, movedFromSourceKey: owner.sourceKey } : { targetId };
}

export function missingUberSourceObjects<T extends UberSourceIdentity>(previous: T[], current: UberSourceIdentity[]): T[] {
  return previous.filter(row => !row.archived && !current.some(node =>
    node.sourceKey === row.sourceKey || (node.kind === row.kind && node.targetId === row.targetId)));
}
