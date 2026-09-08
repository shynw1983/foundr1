// Draft menus can sort first. Only an unambiguous actual shop assignment is
// suitable for the ordinary sales-menu snapshot.
export function selectDemaeSalesMenu(chainId,patterns) {
 if(!Number.isSafeInteger(chainId)||chainId<=0)throw Error('demae_can_catalog_identity_missing');
 if(!Array.isArray(patterns?.menuPatternList)||patterns.isContinueNextPage!==false||patterns.totalCount!==patterns.menuPatternList.length)throw Error('demae_can_catalog_patterns_incomplete');
 if(patterns.menuPatternList.some(row=>String(row.chainId)!==String(chainId)))throw Error('demae_can_catalog_chain_mismatch');
 const assigned=patterns.menuPatternList.filter(row=>row.shopCountPerMenuPattern>0);
 if(assigned.length!==1||assigned[0].shopCountPerMenuPattern!==1||assigned[0].linkedShopList?.length!==1||!assigned[0].menuPatternCode)throw Error('demae_can_catalog_pattern_ambiguous');
 return {chainId,menuPatternCode:String(assigned[0].menuPatternCode)};
}
