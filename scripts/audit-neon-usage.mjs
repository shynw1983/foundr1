import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);
const extensions = await sql`select extname from pg_extension order by extname`;
const hasQueryStats = extensions.some((row) => row.extname === "pg_stat_statements");
const [database] = await sql`
  select
    pg_size_pretty(pg_database_size(current_database())) as size,
    numbackends::int as connections,
    xact_commit::bigint as commits,
    xact_rollback::bigint as rollbacks,
    blks_read::bigint as blocks_read,
    blks_hit::bigint as blocks_hit,
    tup_returned::bigint as rows_returned,
    stats_reset as "statsReset"
  from pg_stat_database
  where datname = current_database()
`;
const tables = await sql`
  select
    relname as table,
    pg_size_pretty(pg_total_relation_size(relid)) as size,
    n_live_tup::bigint as "liveRows",
    seq_scan::bigint as "sequentialScans",
    idx_scan::bigint as "indexScans"
  from pg_stat_user_tables
  order by seq_tup_read desc
  limit 20
`;
const topQueries = hasQueryStats ? await sql`
  select
    calls::bigint,
    round(total_exec_time::numeric, 1) as "totalMs",
    round(mean_exec_time::numeric, 2) as "meanMs",
    rows::bigint,
    left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 300) as query
  from pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
  order by total_exec_time desc
  limit 25
` : [];

console.log(JSON.stringify({
  capturedAt: new Date().toISOString(),
  database,
  pgStatStatementsEnabled: hasQueryStats,
  tables,
  topQueries
}, null, 2));
