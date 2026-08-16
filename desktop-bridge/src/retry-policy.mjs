export const INVENTORY_COMMAND_MAX_ATTEMPTS = 3;
export const DEMAE_CAN_COMMAND_MAX_ATTEMPTS = 1;
export const DEMAE_CAN_CIRCUIT_FAILURE_THRESHOLD = 2;
export const DEMAE_CAN_CIRCUIT_OPEN_MS = 15 * 60 * 1000;

export function inventoryCommandMaxAttempts(platform) {
  return platform === "demae_can"
    ? DEMAE_CAN_COMMAND_MAX_ATTEMPTS
    : INVENTORY_COMMAND_MAX_ATTEMPTS;
}

export function isDemaeCanCircuitFailure(value) {
  return /timed out|timeout|waiting for selector|verification_timeout|protocoltimeout/i.test(String(value ?? ""));
}

export function isRetryableInventoryError(value) {
  const error = String(value ?? "").trim();
  if (!error) return false;
  if (/platform_ui_changed|login required|demae_can_(?:credentials|keychain|login|circuit_open)|unsupported_platform|platform is not enabled|no enabled adapter|missing chrome debugging port/i.test(error)) {
    return false;
  }
  return true;
}

export function partialInventoryTargetError(missingLabels, matchedCount) {
  const labels = Array.from(new Set((missingLabels ?? []).map(String).map((label) => label.trim()).filter(Boolean)));
  if (!labels.length) return "";
  return `部分商品未找到，已处理其余${Math.max(0, Number(matchedCount) || 0)}项；正在重试：${labels.join("、")}`;
}
