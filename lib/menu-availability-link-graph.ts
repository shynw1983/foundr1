export type MenuAvailabilityTargetKey = `${"item" | "option"}:${string}`;

export type MenuAvailabilityLink = {
  sourceKind: "item" | "option";
  sourceId: string;
  dependentKind: "item" | "option";
  dependentId: string;
  isBidirectional: boolean;
};

export function resolveLinkedTargetKeys(
  links: MenuAvailabilityLink[],
  sourceKeys: MenuAvailabilityTargetKey[]
) {
  const edges = new Map<MenuAvailabilityTargetKey, Set<MenuAvailabilityTargetKey>>();
  const addEdge = (from: MenuAvailabilityTargetKey, to: MenuAvailabilityTargetKey) => {
    const targets = edges.get(from) ?? new Set<MenuAvailabilityTargetKey>();
    targets.add(to);
    edges.set(from, targets);
  };

  for (const link of links) {
    const source = `${link.sourceKind}:${link.sourceId}` as MenuAvailabilityTargetKey;
    const dependent = `${link.dependentKind}:${link.dependentId}` as MenuAvailabilityTargetKey;
    addEdge(source, dependent);
    if (link.isBidirectional) addEdge(dependent, source);
  }

  const visited = new Set<MenuAvailabilityTargetKey>(sourceKeys);
  const queue = [...sourceKeys];
  while (queue.length) {
    const current = queue.shift()!;
    for (const target of edges.get(current) ?? []) {
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return [...visited].filter((key) => !sourceKeys.includes(key));
}
