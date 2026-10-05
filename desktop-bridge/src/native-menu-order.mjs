// Merchant APIs may retain creation order in their arrays while carrying the
// customer-facing order on each relationship. Preserve the API sequence only
// when no explicit display order is available; never sort by names or IDs.
export function nativeMenuOrder(rows,key) {
  if(!Array.isArray(rows))return rows;
  const position=row=>row?.[key]!==null&&row?.[key]!==undefined&&row?.[key]!==''&&Number.isFinite(Number(row[key]))
    ?Number(row[key]):Infinity;
  return [...rows].sort((left,right)=>position(left)-position(right));
}
