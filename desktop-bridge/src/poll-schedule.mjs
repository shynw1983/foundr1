// Only discovery cadence changes. A failed business command is never replayed here.
export function createBridgePollSchedule(baseIntervalMs=5000) {
  const base=Number.isFinite(Number(baseIntervalMs))?Math.max(2000,Math.min(60000,Number(baseIntervalMs))):5000;
  let idle=0,failures=0;
  return {
    busy(){idle=0;failures=0;},
    empty(){failures=0;idle=Math.min(idle+1,4);return Math.min(Math.max(base,30000),base*2**idle);},
    failed(){failures=Math.min(failures+1,5);return Math.min(Math.max(base,60000),base*2**failures);}
  };
}
