import { test } from "node:test";
import assert from "node:assert/strict";
import { canReadRankingScope, rankingPool, rankingPosition, rankingOrders, type RankingOption } from "./menu-ranking.ts";
const option = (id:string, overrides:Partial<RankingOption>={}) => ({uber_id:id,category:"配料与加料",preperiod_predecessor_only:false,units:10,selecting_orders:8,paid_optional_topping_unit_rank:2,paid_optional_topping_rank:3,...overrides}) as RankingOption;
test("Categories exclude predecessor identities and preserve stable ranks after filtering",()=>{
 const paid=option("paid"), old=option("old",{preperiod_predecessor_only:true}), free=option("free",{paid_optional_topping_unit_rank:null}), noodle=option("noodle",{category:"面条选择/更换",paid_optional_topping_unit_rank:null});
 const data={options:[paid,old,free,noodle],mains:[]};
 assert.equal(rankingPool(data,"all").length,3);assert.deepEqual(rankingPool(data,"topping"),[paid]);assert.deepEqual(rankingPool(data,"noodle"),[noodle]);assert.equal(rankingPosition(paid,"topping","units",[paid]),2);assert.equal(rankingPosition(paid,"topping","orders",[paid]),3);assert.equal(rankingOrders(paid),8);
});
test("Module and source-store access both required, including selected store context",()=>{
 assert.equal(canReadRankingScope(false,true,[],"source"),false);assert.equal(canReadRankingScope(true,false,[],"source"),false);assert.equal(canReadRankingScope(true,false,["other"],"source"),false);assert.equal(canReadRankingScope(true,false,["source"],"source"),true);assert.equal(canReadRankingScope(true,true,[],"source"),true);
});
