import {readFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {splitSqlStatements} from './sql-statements.mjs';
loadLocalEnv();const sql=neon(process.env.DATABASE_URL);
const statements=splitSqlStatements(await readFile(new URL('../db/uber-option-migrations.sql',import.meta.url),'utf8'));
await sql.transaction(statements.map(statement=>sql.query(statement)));
console.log('Option migration journal installed; activation and stock policy unchanged.');
