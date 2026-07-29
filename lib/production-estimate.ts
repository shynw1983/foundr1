export const BASE_PRODUCTION_MINUTES = 10;
export const EXTRA_BOWL_MINUTES = 2;

export function calculateProductionEstimateMinutes(bowlCount: number) {
  const normalizedBowlCount = Math.max(1, Math.floor(Number.isFinite(bowlCount) ? bowlCount : 1));
  return BASE_PRODUCTION_MINUTES + Math.max(0, normalizedBowlCount - 1) * EXTRA_BOWL_MINUTES;
}
