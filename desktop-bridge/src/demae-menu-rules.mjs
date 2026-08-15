const NOODLE_GROUPS = new Set(["a011", "0009", "0004"]);
const SEASONING_GROUPS = new Set(["a001", "a002", "a003", "a004"]);

export const DEMAE_NOODLE_GROUPS = {
  select: { code: "a011", name: "🍜麺の種類を選ぶ" },
  replace: { code: "0009", name: "🍜麺の種類を変更する" },
  cold: { code: "0004", name: "🍜冷やし麺の種類を選ぶ" }
};

export const DEMAE_ITEM_NOODLE_RULES = new Map([
  ["a0a10001", "select"],
  ["00000001", "select"],
  ["00000002", "select"],
  ["00000003", "cold"],
  ["00000014", "cold"],
  ["a0a10002", "replace"],
  ["a0a10003", "replace"],
  ["00000009", "replace"],
  ["a0a10004", "replace"],
  ["a0a10005", "replace"],
  ["a0a10006", "replace"],
  ["a0a10007", "replace"],
  ["00000004", "replace"],
  ["00000005", "replace"],
  ["00000013", "replace"]
]);

export function normalizeDemaeNoodleGroups(itemCode, groups) {
  const rule = DEMAE_ITEM_NOODLE_RULES.get(String(itemCode));
  const current = [...groups].sort((left, right) => left.dispOrder - right.dispOrder);
  if (!rule || !current.length) return current;
  const desired = DEMAE_NOODLE_GROUPS[rule];
  const withoutNoodles = current.filter((group) => !NOODLE_GROUPS.has(String(group.optionGroupCode)));
  let insertAt = -1;
  for (let index = 0; index < withoutNoodles.length; index += 1) {
    if (SEASONING_GROUPS.has(String(withoutNoodles[index].optionGroupCode))) insertAt = index + 1;
  }
  const result = [...withoutNoodles];
  result.splice(Math.max(0, insertAt), 0, {
    chainId: Number(current[0]?.chainId ?? 410649),
    optionGroupCode: desired.code,
    optionGroupName: desired.name,
    dispOrder: 0
  });
  return result.map((group, index) => ({ ...group, dispOrder: index + 1 }));
}

export function describeDemaeNoodleChange(itemCode, groups) {
  const before = [...groups].sort((left, right) => left.dispOrder - right.dispOrder);
  const after = normalizeDemaeNoodleGroups(itemCode, before);
  const compact = (list) => list.map((group) => `${group.dispOrder}:${group.optionGroupCode}`).join(",");
  return {
    changed: compact(before) !== compact(after)
      || before.some((group, index) => group.optionGroupName !== after[index]?.optionGroupName),
    before,
    after
  };
}
