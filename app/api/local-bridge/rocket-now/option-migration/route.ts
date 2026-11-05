import { createHash } from "node:crypto";
import { authorizeLocalBridge } from "../../../../../lib/local-bridge-auth";
import { sql } from "../../../../../lib/db";
import { recordUberOptionMigration } from "../../../../../lib/uber-option-migration-store";

const storeId = "ed6c3b1f-e68a-4cbd-92e2-06a800eb7183";
const idPattern = /^[1-9][0-9]{0,15}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const protectedId = "8999020";
const phases = ["reserved", "received", "prepared", "complete"];
type Target = { kind: string; targetId: string; sourceKey: string; parentId: string; name: string; price: number;
  archived?: boolean; quarantined?: boolean; mappings: Array<{ externalId: string }> };

export async function POST(request: Request) {
  const auth = await authorizeLocalBridge(request, storeId, "rocket_now");
  if (!auth.authorized || !auth.deviceId || auth.devicePlatform !== "rocket_now"
      || auth.deviceId !== process.env.FOUNDR1_ANDROID_OPTION_MIGRATION_DEVICE_ID) {
    return Response.json({ error: "migration_device_required" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { uberId, fromId, fromParentId, toParentId, phase, newId } = body;
    const releaseDraft = body.releaseDraft === true;
    if (typeof uberId !== "string" || !uuid.test(uberId)
      || ![fromId, fromParentId, toParentId].every(id => typeof id === "string" && idPattern.test(id))
      || fromId === protectedId || fromParentId === toParentId
      || (phase !== undefined && (!phases.includes(phase) || typeof newId !== "string"
        || (phase === "reserved" ? newId !== "" : !idPattern.test(newId) || newId === protectedId)))) {
      return Response.json({ error: "migration_invalid_request" }, { status: 400 });
    }
    const rows = await sql`
      select s.id::text as "sourceId", s.brand_id::text as "brandId", s.revision,
        p.id::text as "platformId", o.target_id::text as "targetId", c.payload,
        s.publish_config->'rocket_now' as config
      from menu_uber_sources s
      join menu_uber_objects o on o.source_id=s.id and o.kind='option' and not o.archived
      join menu_external_platforms p on p.brand_id=s.brand_id and p.store_id is null
        and p.platform_key='rocket_now' and p.is_active
      join lateral (
        select payload from local_bridge_commands
        where store_id=s.store_id and platform='rocket_now' and command_type='publish_menu_changes'
          and payload->>'authoritativePublication'='true' and payload->>'sourceId'=s.id::text
          and payload->>'revision'=s.revision::text
        order by created_at desc limit 1
      ) c on true
      where s.store_id::text=${storeId} and s.enabled and o.uber_id=${uberId}
        and s.uber_store_uuid='d6205da2-b809-531c-a7b2-d9cf505cf1c0'
        and s.publish_config->'rocket_now'->>'merchantId'='118575'
        and s.publish_config->'rocket_now'->>'optionMigrationPolicy'='preserve_stock'
    `;
    const candidates = rows.flatMap(row => {
      const targets = row.payload.targets as Target[];
      const target = targets.find(t => t.kind === "option" && t.targetId === row.targetId && !t.archived && !t.quarantined);
      const parent = targets.find(t => t.kind === "option_group" && t.targetId === target?.parentId && !t.archived && !t.quarantined);
      if (!target || !parent || parent.mappings.length !== 1 || parent.mappings[0].externalId !== toParentId
          || !Number.isSafeInteger(target.price) || target.price < 0
          || ["excludedSourceKeys", "quarantinedSourceKeys", "androidExcludedSourceKeys"]
            .some(key => row.config[key]?.includes(target.sourceKey) || row.config[key]?.includes(parent.sourceKey))) return [];
      return [{ row, target }];
    });
    if (candidates.length !== 1) throw Error("migration_source_conflict");
    const { row, target } = candidates[0];
    const key = createHash("sha256").update([row.sourceId, target.sourceKey, fromId, toParentId].join(":")).digest("hex");
    const [{ state: previous } = {}] = await sql`
      select state from menu_uber_option_migrations
      where source_id=${row.sourceId} and platform='rocket_now' and migration_key=${key}
    `;
    if (previous && (previous.androidDeviceId !== auth.deviceId || (previous.releaseDraft === true) !== releaseDraft)) {
      throw Error("migration_owner_conflict");
    }
    const fromExternalId = previous?.fromExternalId ?? (releaseDraft ? fromId : target.mappings.find(mapping =>
      mapping.externalId === fromId || mapping.externalId === `sub_checkbox_${fromParentId}_${fromId}`)?.externalId);
    if (!fromExternalId) throw Error("migration_predecessor_missing");
    if (!previous && releaseDraft) {
      const existing = await sql`
        select 1 from menu_platform_object_mappings
        where external_platform_id=${row.platformId} and target_type='option' and (
          target_id=${target.targetId} or exists(select 1 from unnest(regexp_split_to_array(external_id,'\\s*,\\s*')) id
            where id=${fromId} or id ~ ${'^sub_checkbox_[0-9]+_' + fromId + '$'}))
        union all
        select 1 from menu_uber_creation_attempts where source_id=${row.sourceId} and platform='rocket_now'
          and source_key=${target.sourceKey} and status<>'rejected'
      `;
      if (target.mappings.length || existing.length) throw Error("migration_draft_identity_conflict");
    } else if (!previous) {
      const existing = await sql`
        select count(*)::int as matches from menu_platform_object_mappings
        where external_platform_id=${row.platformId} and target_type='option' and target_id=${target.targetId}
          and (store_id is null or store_id::text=${storeId})
          and ${fromExternalId}=any(regexp_split_to_array(external_id,'\\s*,\\s*'))
      `;
      if (existing[0]?.matches !== 1) throw Error("migration_predecessor_stale");
    }
    const identity = { key, marker: `FS${key.slice(0, 14)}` };
    if (phase === undefined) return Response.json({ identity, target, state: previous ?? null });
    if (previous && previous.fromParentId !== fromParentId) throw Error("migration_parent_conflict");
    if (previous && previous.phase === phase && previous.newId === newId) return Response.json({ state: previous });
    const displayStatus = previous?.displayStatus ?? body.displayStatus;
    const state = { ...identity, sourceKey: target.sourceKey, targetId: target.targetId,
      fromExternalId, fromId, fromParentId, toParentId, name: target.name, price: target.price,
      displayStatus, phase, newId, ...(releaseDraft ? { releaseDraft: true } : {}) };
    await recordUberOptionMigration({ sourceId: row.sourceId, storeId, brandId: row.brandId,
      platformId: row.platformId, revision: Number(row.revision), androidDeviceId: auth.deviceId, state,
      payload: { ...row.payload, optionMigrationPolicy: "preserve_stock", androidDraftRelease: releaseDraft } });
    return Response.json({ state });
  } catch {
    return Response.json({ error: "migration_state_conflict" }, { status: 409 });
  }
}
