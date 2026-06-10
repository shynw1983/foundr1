export function normalizeIntegerInput(value: string) {
  return normalizeNumberInput(value, { decimal: false });
}

export function normalizeDecimalInput(value: string) {
  return normalizeNumberInput(value, { decimal: true });
}

function normalizeNumberInput(value: string, options: { decimal: boolean }) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[￥¥円,\s]/g, "");
  const filtered = normalized.replace(options.decimal ? /[^\d.]/g : /[^\d]/g, "");
  if (!options.decimal) return filtered;

  const [head, ...tail] = filtered.split(".");
  return tail.length ? `${head}.${tail.join("")}` : head;
}
