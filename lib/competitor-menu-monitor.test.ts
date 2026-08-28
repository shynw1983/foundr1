import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCompetitorProductIdentity } from "./competitor-menu-identity.ts";

test("treats bare and prefixed Uber UUIDs as the same product identity", () => {
  const uuid = "d7e1189b-5e61-5380-93ac-9c67f13cb358";
  assert.equal(canonicalCompetitorProductIdentity(uuid), uuid);
  assert.equal(canonicalCompetitorProductIdentity(`id:${uuid}`), uuid);
});

test("keeps derived identities distinct from Uber IDs", () => {
  assert.equal(canonicalCompetitorProductIdentity("derived:menu-hash"), "derived:menu-hash");
});
