export const INVENTORY_COMMAND_MAX_ATTEMPTS = 3;

export function isRetryableInventoryError(value) {
  const error = String(value ?? "").trim();
  if (!error) return false;
  if (/platform_ui_changed|login required|demae_can_(?:credentials|keychain|login)|unsupported_platform|platform is not enabled|no enabled adapter|missing chrome debugging port/i.test(error)) {
    return false;
  }
  return true;
}
