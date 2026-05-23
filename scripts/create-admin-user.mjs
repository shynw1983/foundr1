import { pbkdf2Sync, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

const [, , loginIdArg, passwordArg, nameArg] = process.argv;
const loginId = loginIdArg || process.env.ADMIN_LOGIN_ID || "owner";
const password = passwordArg || process.env.ADMIN_PASSWORD;
const name = nameArg || process.env.ADMIN_NAME || "管理者";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

if (!password) {
  throw new Error("Usage: node scripts/create-admin-user.mjs <loginId> <password> [name]");
}

function hashPassword(value) {
  const salt = randomBytes(16).toString("base64url");
  const iterations = 210_000;
  const hash = pbkdf2Sync(value, salt, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

const sql = neon(process.env.DATABASE_URL);

await sql.query("alter table employees add column if not exists login_id text unique");
await sql.query("alter table employees add column if not exists password_hash text");

await sql`
  insert into employees (name, login_id, role, status, password_hash, updated_at)
  values (${name}, ${loginId}, 'owner', 'active', ${hashPassword(password)}, now())
  on conflict (login_id)
  do update set
    name = excluded.name,
    role = 'owner',
    status = 'active',
    password_hash = excluded.password_hash,
    updated_at = now()
`;

console.log(JSON.stringify({ ok: true, loginId, name }, null, 2));
