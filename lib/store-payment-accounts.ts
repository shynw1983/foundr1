import { sql } from "./db";

export type StorePaymentAccount = {
  id: string;
  storeId: string;
  provider: string;
  accountName: string;
  secretKey: string;
  webhookSecret: string;
  paymentTypesEnvName: string;
  paymentTypes: string[];
};

type StorePaymentAccountRow = {
  id: string;
  storeId: string;
  provider: string;
  accountName: string;
  secretKey: string;
  secretKeyEnvName: string;
  webhookSecret: string;
  webhookSecretEnvName: string;
  paymentTypes: string[] | null;
  paymentTypesEnvName: string;
};

function clean(value = "") {
  return String(value).trim().replace(/^["']|["']$/g, "");
}

function readSecret(value = "", envName = "") {
  const direct = clean(value);
  if (direct) return direct;
  const key = clean(envName);
  return key ? clean(process.env[key]) : "";
}

function parsePaymentTypes(value = "") {
  return clean(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function readPaymentTypes(values: string[] | null, envName = "") {
  const key = clean(envName);
  if (key) {
    const envValues = parsePaymentTypes(process.env[key]);
    if (envValues.length) return envValues;
  }
  return Array.isArray(values) ? values.map(String).filter(Boolean) : [];
}

function hydrate(row: StorePaymentAccountRow): StorePaymentAccount {
  return {
    id: row.id,
    storeId: row.storeId,
    provider: row.provider,
    accountName: row.accountName,
    secretKey: readSecret(row.secretKey, row.secretKeyEnvName),
    webhookSecret: readSecret(row.webhookSecret, row.webhookSecretEnvName),
    paymentTypesEnvName: row.paymentTypesEnvName,
    paymentTypes: readPaymentTypes(row.paymentTypes, row.paymentTypesEnvName)
  };
}

function fallbackKomojuAccount(storeId: string): StorePaymentAccount | null {
  const secretKey = clean(process.env.KOMOJU_SECRET_KEY);
  if (!secretKey) return null;
  return {
    id: "",
    storeId,
    provider: "komoju",
    accountName: "KOMOJU fallback",
    secretKey,
    webhookSecret: clean(process.env.KOMOJU_WEBHOOK_SECRET || process.env.KOMOJU_WEBHOOK_SECRET_TOKEN),
    paymentTypesEnvName: "KOMOJU_PAYMENT_TYPES",
    paymentTypes: parsePaymentTypes(process.env.KOMOJU_PAYMENT_TYPES)
  };
}

export async function getActiveStorePaymentAccount(input: {
  storeId: string;
  provider: string;
  allowFallback?: boolean;
}) {
  const rows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      provider,
      account_name as "accountName",
      secret_key as "secretKey",
      secret_key_env_name as "secretKeyEnvName",
      webhook_secret as "webhookSecret",
      webhook_secret_env_name as "webhookSecretEnvName",
      payment_types as "paymentTypes",
      payment_types_env_name as "paymentTypesEnvName"
    from store_payment_accounts
    where store_id = ${input.storeId}
      and provider = ${input.provider}
      and is_active = true
    order by updated_at desc
    limit 1
  `;
  const account = rows[0] ? hydrate(rows[0] as StorePaymentAccountRow) : null;
  if (account) return account;
  if (input.allowFallback && input.provider === "komoju") return fallbackKomojuAccount(input.storeId);
  return null;
}

export async function getActiveStorePaymentAccountByStoreReference(input: {
  storeReference: string;
  provider: string;
  allowFallback?: boolean;
}) {
  const rows = await sql`
    select
      store_payment_accounts.id::text,
      store_payment_accounts.store_id::text as "storeId",
      store_payment_accounts.provider,
      store_payment_accounts.account_name as "accountName",
      store_payment_accounts.secret_key as "secretKey",
      store_payment_accounts.secret_key_env_name as "secretKeyEnvName",
      store_payment_accounts.webhook_secret as "webhookSecret",
      store_payment_accounts.webhook_secret_env_name as "webhookSecretEnvName",
      store_payment_accounts.payment_types as "paymentTypes",
      store_payment_accounts.payment_types_env_name as "paymentTypesEnvName"
    from store_payment_accounts
    join stores on stores.id = store_payment_accounts.store_id
    where store_payment_accounts.provider = ${input.provider}
      and store_payment_accounts.is_active = true
      and (
        stores.id::text = ${input.storeReference}
        or stores.external_id = ${input.storeReference}
        or stores.name = ${input.storeReference}
      )
    order by store_payment_accounts.updated_at desc
    limit 1
  `;
  const account = rows[0] ? hydrate(rows[0] as StorePaymentAccountRow) : null;
  if (account) return account;
  if (input.allowFallback && input.provider === "komoju") {
    const stores = await sql`
      select id::text
      from stores
      where id::text = ${input.storeReference}
        or external_id = ${input.storeReference}
        or name = ${input.storeReference}
      limit 1
    `;
    return fallbackKomojuAccount(String(stores[0]?.id ?? input.storeReference));
  }
  return null;
}

export async function getStorePaymentAccountForWebhook(input: {
  storeId: string;
  provider: string;
  allowFallback?: boolean;
}) {
  const account = await getActiveStorePaymentAccount(input);
  if (!account?.webhookSecret && input.allowFallback && input.provider === "komoju") {
    return fallbackKomojuAccount(input.storeId);
  }
  return account;
}
