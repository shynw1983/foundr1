import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryUsageSummary, calibrateUnmeasuredUsage, type InventoryUsageMovement } from "./inventory-usage-policy.ts";
const now = "2026-10-11T12:00:00Z";
const anchor = { checkId: "c1", quantity: 10, countUnit: "個", countedAt: "2026-10-09T12:00:00Z" };
const movement = (overrides: Partial<InventoryUsageMovement>): InventoryUsageMovement => ({id:"1",kind:"order_use",quantity:-1,countUnit:"個",confidence:"exact",exposure:1,occurredAt:"2026-10-10T12:00:00Z",createdAt:"2026-10-10T12:00:00Z",changesStock:true,metadata:{},...overrides});
const summary = (overrides: Partial<Parameters<typeof buildInventoryUsageSummary>[0]> = {}) => buildInventoryUsageSummary({inventoryItemId:"i",productId:"p",productName:"Octopus",locationName:"Freezer",countUnit:"個",bookQuantity:49,anchor,movements:[movement({kind:"receipt",quantity:40,exposure:0}),movement({})],unmappedOrders:0,now,...overrides});
test("count origin plus two known twenty-piece bags minus one order stays separate from physical count",()=>{
 const value=summary();assert.equal(value.anchor?.quantity,10);assert.equal(value.receivedQuantity,40);assert.equal(value.orderDeductedQuantity,1);assert.equal(value.bookExpectedQuantity,49);assert.equal(value.forecastQuantity,49);assert.equal(value.confidence,"confirmed");
});
test("recipe estimates subtract only from the projection and never from the exact book",()=>{
 const value=summary({bookQuantity:10,movements:[movement({quantity:-0.25,confidence:"estimate",changesStock:false})]});assert.equal(value.bookExpectedQuantity,10);assert.equal(value.forecastQuantity,9.75);assert.equal(value.estimatedUsageQuantity,0.25);assert.equal(value.confidence,"estimated");
});
test("unknown stock, packaging, or unmeasured use without a calibration does not become zero",()=>{
 assert.equal(summary({bookQuantity:null}).forecastQuantity,null);
 const value=summary({movements:[movement({quantity:null,confidence:"unmeasured",changesStock:false})]});assert.equal(value.forecastQuantity,null);assert.ok(value.issueReasons.includes("prediction_basis_missing"));
 assert.equal(summary({movements:[movement({kind:"receipt",quantity:null,metadata:{balanceUnknown:true}})]}).receivedQuantity,null);
});
test("a paired counted interval estimates observed depletion per mapped exposure, not actual waste",()=>{
 const intervals=[{checkId:"c2",startedAt:"2026-10-06T12:00:00Z",endedAt:"2026-10-09T12:00:00Z",countUnit:"個",anchorQuantity:100,observedQuantity:80,incomingQuantity:10,exactOrderUsage:10,otherDelta:-5,unknownExposure:30,issueReasons:["unmeasured_usage"]}];
 const model=calibrateUnmeasuredUsage(intervals,"個");assert.equal(model?.quantityPerExposure,0.5);
 const value=summary({bookQuantity:80,movements:[movement({quantity:null,confidence:"unmeasured",changesStock:false,exposure:4})],intervals});assert.equal(value.forecastQuantity,78);assert.equal(value.forecastSource,"calibrated");assert.equal(value.calibrationIntervals,1);
});
test("incomplete or mixed-unit calibration intervals cannot teach a false consumption coefficient",()=>{
 const base={checkId:"c",startedAt:"2026-10-06T00:00:00Z",endedAt:"2026-10-09T00:00:00Z",countUnit:"個",anchorQuantity:100,observedQuantity:80,incomingQuantity:0,exactOrderUsage:0,otherDelta:0,unknownExposure:20,issueReasons:[]};
 assert.equal(calibrateUnmeasuredUsage([{...base,issueReasons:["unmapped_orders"]}],"個"),null);
 assert.equal(calibrateUnmeasuredUsage([{...base,countUnit:"袋"}],"個"),null);
 assert.equal(calibrateUnmeasuredUsage([{...base,issueReasons:["estimated_inputs"]}],"個"),null);
});
test("unmapped orders suppress depletion-date claims; forecast is labelled partial",()=>{
 const value=summary({unmappedOrders:2});assert.equal(value.daysRemaining,null);assert.equal(value.confidence,"unknown");assert.ok(value.issueReasons.includes("prediction_partial"));
});
test("late orders before a new actual anchor are not subtracted again",()=>{
 const value=summary({bookQuantity:20,anchor:{...anchor,countedAt:"2026-10-11T00:00:00Z"},movements:[movement({quantity:-5,createdAt:now})]});assert.equal(value.orderDeductedQuantity,0);assert.equal(value.forecastQuantity,20);
});
test("a fresh count resets the balance interval without resetting enabled demand history",()=>{
 const value=summary({bookQuantity:20,anchor:{...anchor,countedAt:"2026-10-11T00:00:00Z"},trackingFrom:"2026-10-09T12:00:00Z",movements:[movement({quantity:-4})]});assert.equal(value.dailyUsage,2);assert.equal(value.daysRemaining,10);
});

test("a current recipe calibration never reinterprets older recipe exposure in balance or demand",()=>{
 const interval={checkId:"c",startedAt:"2026-10-06T00:00:00Z",endedAt:"2026-10-09T00:00:00Z",countUnit:"個",anchorQuantity:100,observedQuantity:90,incomingQuantity:0,exactOrderUsage:0,otherDelta:0,unknownExposure:1,issueReasons:["unmeasured_usage"],recipeVersionIds:["v2"]};
 const aggregate={incoming:0,exactOrderUsage:0,estimatedUsage:0,unknownExposure:1,mappedExposure:1,broken:false,unmeasuredProduction:false,trendExactUsage:0,trendEstimatedUsage:0,trendUnknownExposure:11,trendBroken:false,activeUnmeasuredRecipeVersionIds:["v2"],unknownRecipeVersionIds:["v1"],trendUnknownRecipeVersionIds:["v1","v2"]};
 const mixed=summary({bookQuantity:100,movements:[],intervals:[interval],aggregate});assert.equal(mixed.forecastQuantity,null);assert.equal(mixed.dailyUsage,null);assert.equal(mixed.daysRemaining,null);
 const matched=summary({bookQuantity:100,movements:[],intervals:[interval],aggregate:{...aggregate,unknownExposure:0,unknownRecipeVersionIds:[],trendUnknownExposure:1,trendUnknownRecipeVersionIds:["v2"]}});assert.equal(matched.forecastQuantity,100);assert.equal(matched.dailyUsage,5);assert.equal(matched.confidence,"estimated");
});
