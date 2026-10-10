export type InventoryUsageConfidence = "confirmed" | "estimated" | "unknown";
export type InventoryUsageAnchor = { checkId: string; quantity: number; countUnit: string; countedAt: string };
export type InventoryUsageCoverage = { mappedServings: number; unmappedOrders: number };
export type InventoryUsageItemSummary = {
  inventoryItemId: string; productId: string; productName: string; locationName: string; countUnit: string;
  anchor: InventoryUsageAnchor | null;
  receivedQuantity: number | null; orderDeductedQuantity: number | null;
  bookExpectedQuantity: number | null; estimatedUsageQuantity: number | null;
  forecastQuantity: number | null; dailyUsage: number | null; daysRemaining: number | null;
  forecastSource: "recipe" | "calibrated" | "mixed" | "none";
  calibrationIntervals: number; confidence: InventoryUsageConfidence; issueReasons: string[];
  coverage: InventoryUsageCoverage; asOf: string;
};
export type InventoryCountReconciliation = {
  anchorCheckId: string | null; anchorQuantity: number | null;
  expectedQuantity: number | null; observedQuantity: number; difference: number | null;
  countUnit: string; receivedQuantity: number | null; orderDeductedQuantity: number | null;
  estimatedUsageQuantity: number | null; unknownExposure: number;
  confidence: InventoryUsageConfidence; issueReasons: string[];
  countedAt: string; periodStartedAt: string | null; movementCutoffId: string | null;
};
export type InventoryUsageResponse = {
  selectedStoreId: string; items: InventoryUsageItemSummary[];
  recentReconciliations: Array<{ id: string; productName: string; locationName: string; snapshot: InventoryCountReconciliation }>;
  settings: { enabled: boolean; enabledFrom: string | null; triggerMode: "preparation" | "confirmed_sale" };
};
export type InventoryUsageMovement = {
  id: string; kind: string; quantity: number | null; countUnit: string;
  confidence: "exact" | "estimate" | "unmeasured"; exposure: number;
  occurredAt: string; createdAt: string; changesStock: boolean; recipeVersionId?: string | null; metadata: Record<string, unknown>;
};
export type InventoryUsageAggregate = {
  incoming: number; exactOrderUsage: number; estimatedUsage: number; unknownExposure: number;
  mappedExposure: number; broken: boolean; unmeasuredProduction: boolean;
  trendExactUsage: number; trendEstimatedUsage: number; trendUnknownExposure: number; trendBroken: boolean;
  activeUnmeasuredRecipeVersionIds?: string[]; unknownRecipeVersionIds?: string[]; trendUnknownRecipeVersionIds?: string[];
};
export type CalibrationInterval = {
  checkId: string; startedAt: string; endedAt: string; countUnit: string;
  anchorQuantity: number; observedQuantity: number; incomingQuantity: number;
  exactOrderUsage: number; otherDelta: number; unknownExposure: number;
  issueReasons: string[]; recipeVersionIds?: string[];
};
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function round(value: number) { return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000; }
/** Mean observed depletion includes real preparation variation and losses; it is a forecast, never a waste fact. */
export function calibrateUnmeasuredUsage(intervals: CalibrationInterval[], unit: string, activeRecipeVersions?: string[]) {
  const valid = intervals.filter(i => i.countUnit === unit && i.issueReasons.every(reason => reason === "unmeasured_usage" || reason === "prediction_basis_missing") &&
    (activeRecipeVersions === undefined || JSON.stringify([...(i.recipeVersionIds ?? [])].sort()) === JSON.stringify([...activeRecipeVersions].sort())) &&
    [i.anchorQuantity, i.observedQuantity, i.incomingQuantity, i.exactOrderUsage, i.otherDelta, i.unknownExposure].every(finite) &&
    i.unknownExposure > 0 && Date.parse(i.endedAt) > Date.parse(i.startedAt));
  let depletion = 0, exposure = 0, used = 0;
  for (const interval of valid) {
    const amount = interval.anchorQuantity + interval.incomingQuantity + interval.otherDelta - interval.observedQuantity - interval.exactOrderUsage;
    if (amount < 0) continue;
    depletion += amount; exposure += interval.unknownExposure; used++;
  }
  return exposure > 0 ? { quantityPerExposure: round(depletion / exposure), intervals: used, exposure, observedDepletion: round(depletion) } : null;
}
export function buildInventoryUsageSummary(input: {
  inventoryItemId: string; productId: string; productName: string; locationName: string; countUnit: string;
  bookQuantity: number | null; anchor: InventoryUsageAnchor | null; movements: InventoryUsageMovement[];
  intervals?: CalibrationInterval[]; aggregate?: InventoryUsageAggregate; unmappedOrders: number; now: string; trackingFrom?: string | null;
}): InventoryUsageItemSummary {
  const reasons = new Set<string>();
  const anchorTime = input.anchor ? Date.parse(input.anchor.countedAt) : NaN;
  const nowTime = Date.parse(input.now);
  if (!input.anchor || input.anchor.countUnit !== input.countUnit || !Number.isFinite(anchorTime)) reasons.add("anchor_missing");
  if (!finite(input.bookQuantity)) reasons.add("book_unknown");
  if (input.unmappedOrders > 0) reasons.add("unmapped_orders");
  const movementTime = (m: InventoryUsageMovement) => Date.parse(m.occurredAt);
  const current = input.movements.filter(m => Number.isFinite(movementTime(m)) && (!Number.isFinite(anchorTime) || movementTime(m) > anchorTime) && movementTime(m) <= nowTime);
  let received = 0, exactOrders = 0, estimates = 0, unknownExposure = 0, mappedServings = 0;
  let invalidQuantity = false;
  for (const movement of current) {
    if (movement.kind === "count") continue;
    if (movement.countUnit !== input.countUnit) { reasons.add("unit_changed"); invalidQuantity = true; continue; }
    if (movement.metadata.quantityUnknown === true || movement.metadata.balanceUnknown === true) { reasons.add("movement_unknown"); invalidQuantity = true; }
    if (movement.kind === "production_input" && movement.confidence === "estimate" && finite(movement.quantity)) estimates += Math.max(0,-movement.quantity);
    if (movement.kind === "production_input" && movement.confidence === "unmeasured") { reasons.add("unmeasured_production"); invalidQuantity = true; }
    if (movement.kind === "order_use") {
      mappedServings += finite(movement.exposure) ? movement.exposure : 0;
      if (movement.confidence === "exact" && finite(movement.quantity)) exactOrders += Math.max(0, -movement.quantity);
      else if (movement.confidence === "estimate" && finite(movement.quantity)) estimates += Math.max(0, -movement.quantity);
      else unknownExposure += finite(movement.exposure) ? movement.exposure : 0;
    }
    if (movement.changesStock && finite(movement.quantity) && movement.quantity > 0) received += movement.quantity;
  }
  if (input.aggregate) {
    received = input.aggregate.incoming; exactOrders = input.aggregate.exactOrderUsage;
    estimates = input.aggregate.estimatedUsage; unknownExposure = input.aggregate.unknownExposure;
    mappedServings = input.aggregate.mappedExposure; invalidQuantity = input.aggregate.broken || input.aggregate.unmeasuredProduction;
    if (input.aggregate.broken) reasons.add("movement_unknown");
    if (input.aggregate.unmeasuredProduction) reasons.add("unmeasured_production");
  }
  const sameVersions = (versions: string[] | undefined) => versions === undefined || input.aggregate?.activeUnmeasuredRecipeVersionIds === undefined || JSON.stringify([...versions].sort()) === JSON.stringify([...input.aggregate.activeUnmeasuredRecipeVersionIds].sort());
  const calibration = calibrateUnmeasuredUsage(input.intervals ?? [], input.countUnit, input.aggregate?.activeUnmeasuredRecipeVersionIds);
  const currentCalibration = sameVersions(input.aggregate?.unknownRecipeVersionIds) ? calibration : null;
  const trendCalibration = sameVersions(input.aggregate?.trendUnknownRecipeVersionIds) ? calibration : null;
  if (unknownExposure > 0 && !currentCalibration) reasons.add("prediction_basis_missing");
  const calibrated = unknownExposure > 0 && currentCalibration ? unknownExposure * currentCalibration.quantityPerExposure : 0;
  const estimatedUsage = estimates + calibrated;
  const basisExists = estimates > 0 || (unknownExposure > 0 && currentCalibration !== null);
  const forecast = finite(input.bookQuantity) && !invalidQuantity && (unknownExposure === 0 || currentCalibration !== null)
    ? round(input.bookQuantity - estimatedUsage) : null;
  const trackingTime = input.trackingFrom ? Date.parse(input.trackingFrom) : anchorTime;
  const trendStart = Math.max(nowTime - 7 * 86_400_000, Number.isFinite(trackingTime) ? trackingTime : nowTime);
  const ageDays = (nowTime - trendStart) / 86_400_000;
  let trendUsage = 0, trendUnknown = false;
  for (const movement of input.movements) {
    const time = movementTime(movement);
    if (movement.kind !== "order_use" || time <= trendStart || time > nowTime) continue;
    if (movement.countUnit !== input.countUnit) { trendUnknown = true; continue; }
    if (finite(movement.quantity) && movement.confidence !== "unmeasured") trendUsage += Math.max(0, -movement.quantity);
    else if (calibration && finite(movement.exposure)) trendUsage += Math.max(0, movement.exposure * calibration.quantityPerExposure);
    else trendUnknown = true;
  }
  if (input.aggregate) {
    trendUsage = input.aggregate.trendExactUsage + input.aggregate.trendEstimatedUsage + (trendCalibration ? input.aggregate.trendUnknownExposure * trendCalibration.quantityPerExposure : 0);
    trendUnknown = input.aggregate.trendBroken || (input.aggregate.trendUnknownExposure > 0 && !trendCalibration);
  }
  // A full day of enabled order tracking is needed; counts do not reset this demand trend.
  const daily = ageDays >= 1 && trendUsage > 0 && !trendUnknown && !invalidQuantity
    ? round(trendUsage / ageDays) : null;
  const days = daily !== null && daily > 0 && forecast !== null && input.unmappedOrders === 0 ? round(Math.max(0, forecast) / daily) : null;
  if (input.unmappedOrders > 0) reasons.add("prediction_partial");
  if (input.aggregate && input.aggregate.trendUnknownExposure > 0 && !trendCalibration) reasons.add("prediction_basis_missing");
  return {
    inventoryItemId: input.inventoryItemId, productId: input.productId, productName: input.productName,
    locationName: input.locationName, countUnit: input.countUnit, anchor: input.anchor,
    receivedQuantity: input.anchor && !invalidQuantity ? round(received) : null,
    orderDeductedQuantity: input.anchor && !invalidQuantity ? round(exactOrders) : null,
    bookExpectedQuantity: input.bookQuantity, estimatedUsageQuantity: basisExists ? round(estimatedUsage) : null,
    forecastQuantity: forecast, dailyUsage: daily, daysRemaining: days,
    forecastSource: estimates > 0 && unknownExposure > 0 && currentCalibration ? "mixed" : estimates > 0 ? "recipe" : unknownExposure > 0 && currentCalibration ? "calibrated" : "none",
    calibrationIntervals: calibration?.intervals ?? 0,
    confidence: reasons.size ? "unknown" : basisExists || unknownExposure > 0 || (input.aggregate?.trendEstimatedUsage ?? 0) > 0 || (input.aggregate?.trendUnknownExposure ?? 0) > 0 ? "estimated" : "confirmed",
    issueReasons: [...reasons], coverage: { mappedServings: round(mappedServings), unmappedOrders: input.unmappedOrders }, asOf: input.now
  };
}
