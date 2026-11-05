export type PickupCall = { pickupCode: string; callVersion?: number };

/** A repeated call has a newer version; an unchanged poll must stay silent. */
export function updatePickupCalls(previous: Map<string, number> | null, ready: PickupCall[]) {
  const versions = new Map<string, number>();
  for (const order of ready) {
    const value = Number(order.callVersion ?? 0);
    const version = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    versions.set(order.pickupCode, Math.max(version, versions.get(order.pickupCode) ?? 0));
  }
  const calls: string[] = [];
  for (const [code, version] of versions) {
    if (previous && (!previous.has(code) || version > previous.get(code)!)) calls.push(code);
    // An older read cannot roll the call counter back and cause a duplicate later.
    versions.set(code, Math.max(version, previous?.get(code) ?? 0));
  }
  return { versions, calls };
}
