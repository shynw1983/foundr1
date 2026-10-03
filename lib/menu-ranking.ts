export type RankingOption = {
  uber_id: string; name: string; category: string; current_member: boolean; units: number;
  selecting_orders: number; cancelled_units: number; eligible_orders: number; selecting_eligible_orders: number;
  current_available: boolean | null; current_availability_asof: string | null;
  preperiod_predecessor_only: boolean; stockout_warning: boolean; short_exposure_warning: boolean;
  required_optional: string; free_paid: string; option_rate_pct: number | null; selecting_orders_outside_denominator: number;
  first_selling_day: string | null; last_selling_day: string | null; selling_day_count: number;
  category_rank: number | null; category_unit_rank: number | null;
  paid_optional_topping_rank: number | null; paid_optional_topping_unit_rank: number | null;
  ranking_warning: string; aliases: string[]; historical_memberships: string[]; current_groups: string[];
  first_graph_membership: {time: string} | null; last_graph_absent_before_first: {time: string} | null;
  candidate: boolean; verified_unavailable_command_count: number;
};
export type RankingMain = {
  uber_id: string; name: string; current_member: boolean; units: number; orders: number; cancelled_units: number;
  main_category: string; main_rank: number | null; informational_nonproduct: boolean;
  current_available: boolean | null; stockout_warning: boolean; share_of_captured_orders_pct: number;
  aliases: string[]; current_availability_asof: string | null; selling_dates: string[];
};
export type MenuRanking = {
  month: string; period: string; store: {id: string; name: string};
  summary: Record<string, number | string | string[]>;
  options: RankingOption[]; mains: RankingMain[];
  categories: Record<string, number>; methodology: Record<string, string>;
  unresolved: {name: string; units: number; orders: number; dates: string[]; reason: string}[];
  provenance: {libraryFileId: string; sourceSha256: string; prototypeCommit: string};
};
export type RankingMode = "topping" | "noodle" | "main" | "controls" | "all";
export function rankingPool(data: Pick<MenuRanking, "options" | "mains">, mode: RankingMode): (RankingOption | RankingMain)[] {
  if (mode === "main") return data.mains.filter(p => !p.informational_nonproduct);
  return data.options.filter(p => !p.preperiod_predecessor_only && (
    mode === "all" || (mode === "topping" && Boolean(p.paid_optional_topping_unit_rank)) ||
    (mode === "noodle" && p.category === "面条选择/更换") ||
    (mode === "controls" && !["配料与加料", "面条选择/更换"].includes(p.category))));
}
export function rankingOrders(p: RankingOption | RankingMain) { return "selecting_orders" in p ? p.selecting_orders : p.orders; }
export function rankingPosition(p: RankingOption | RankingMain, mode: RankingMode, sort: string, pool: (RankingOption | RankingMain)[]) {
  if (!("category" in p)) return 1 + pool.filter(x => (sort === "orders" ? rankingOrders(x) : x.units) > (sort === "orders" ? rankingOrders(p) : p.units)).length;
  if (mode === "topping") return sort === "orders" ? p.paid_optional_topping_rank : p.paid_optional_topping_unit_rank;
  return sort === "orders" ? p.category_rank : p.category_unit_rank;
}
export function canReadRankingScope(permission: boolean, allStores: boolean, storeIds: string[], sourceStoreId: string) {
  return permission && (allStores || storeIds.includes(sourceStoreId));
}
