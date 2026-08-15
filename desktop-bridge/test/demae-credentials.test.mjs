import assert from "node:assert/strict";
import test from "node:test";

import { DEMAE_KEYCHAIN_SERVICE, loadDemaeCredentials } from "../src/demae-credentials.mjs";

test("loads all Demae credentials from the macOS Keychain service", async () => {
  const values = new Map([["handle-code", "store-code"], ["login-id", "operator"], ["password", "secret"]]);
  const calls = [];
  const credentials = await loadDemaeCredentials(async (file, args) => {
    calls.push({ file, args });
    return { stdout: `${values.get(args[args.indexOf("-a") + 1])}\n` };
  });
  assert.deepEqual(credentials, { handleCode: "store-code", loginId: "operator", password: "secret" });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ file, args }) => file === "/usr/bin/security" && args.includes(DEMAE_KEYCHAIN_SERVICE)));
});

test("reports missing Demae credentials without exposing partial values", async () => {
  await assert.rejects(
    loadDemaeCredentials(async (_file, args) => ({ stdout: args.includes("password") ? "" : "present\n" })),
    { message: "demae_can_credentials_missing" }
  );
});
