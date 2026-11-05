import { createHash, randomUUID } from "node:crypto";
import webPush from "web-push";
import { sql } from "./db";
import { getInventorySyncAttentionCommands, inventorySyncCommandRecheckSql } from "./inventory-sync-attention";
import { publishOsNotificationEvent } from "./notification-realtime";
import { getOrderPushConfig, OrderPushTransportError, sendOrderPush, type OrderPushDevice } from "./store-order-push-transport";

type AttentionCommand = Awaited<ReturnType<typeof getInventorySyncAttentionCommands>>[number];
type Recipient = { id: string };
type WebSubscription = { id: string; employeeId: string; endpoint: string; p256dh: string; auth: string };
type DeliveryChannel = "web_push" | "fcm";
type DeliveryJob = {
  command: AttentionCommand;
  employeeId: string;
  channel: DeliveryChannel;
  destinationId: string;
  sessionId?: string;
  registrationToken?: string;
  endpoint?: string;
  destinationKey: string;
  send: (command: AttentionCommand) => Promise<void>;
};

const notificationType = "inventory_sync_attention";
const webPushTimeoutMs = 8_000;
const deliveryLeaseSeconds = 120;
const dispatchBudgetMs = 25_000;
const platformNames: Record<string, string> = { uber_eats: "Uber Eats", rocket_now: "Rocket Now", demae_can: "出前館" };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function inventorySyncAttentionText(command: AttentionCommand, language = "ja") {
  const isAvailable = command.payload?.isAvailable === true;
  const labels = command.targetLabels.filter(Boolean);
  const label = labels.length ? labels.slice(0, 3).join("、") + (labels.length > 3 ? ` +${labels.length - 3}` : "") : "商品";
  const platform = platformNames[command.platform] || command.platform;
  const store = command.storeName ? `${command.storeName}：` : "";
  const waiting = command.status !== "failed";
  if (language === "zh-Hans") return {
    title: isAvailable ? "上架同步尚未确认" : "⚠ 下架同步尚未确认",
    body: `${store}${label}已请求${isAvailable ? "上架" : "下架"}，${platform}${waiting ? command.overdue ? "超过 5 分钟尚未完成" : "重新同步尚未完成" : "同步失败"}。请确认销售状态。`
  };
  if (language === "zh-Hant") return {
    title: isAvailable ? "上架同步尚未確認" : "⚠ 下架同步尚未確認",
    body: `${store}${label}已請求${isAvailable ? "上架" : "下架"}，${platform}${waiting ? command.overdue ? "超過 5 分鐘尚未完成" : "重新同步尚未完成" : "同步失敗"}。請確認銷售狀態。`
  };
  return {
    title: isAvailable ? "販売再開の同期を確認してください" : "⚠ 販売停止の同期を確認してください",
    body: `${store}${label}の${isAvailable ? "販売再開" : "販売停止"}を依頼しましたが、${platform}${waiting ? command.overdue ? "で5分以上完了していません" : "で再試行の完了を待っています" : "への同期に失敗しました"}。販売状態を確認してください。`
  };
}

function attentionHref(command: AttentionCommand) {
  return `/store/menu?syncAttention=1&storeId=${encodeURIComponent(command.storeId)}`;
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("INVENTORY_SYNC_PUSH_TIMEOUT")), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Match the full Store workbench and active-session rules. Personal inventory-only
// accounts are not subscribed to sales-status operations by this feature.
async function getRecipients(storeId: string): Promise<Recipient[]> {
  return await sql`
    select distinct e.id::text
    from employees e join stores s on s.id::text = ${storeId} and s.status = 'active'
    join employee_sessions es on es.employee_id = e.id and es.session_version = e.session_version
      and es.revoked_at is null and (
        es.expires_at > now() or (e.role = 'store_terminal' and es.surface = 'store' and es.created_at > now() - interval '400 days')
      )
    where e.status = 'active' and e.role in ('owner', 'manager', 'store_owner', 'store_terminal')
      and (e.role in ('owner', 'manager') or exists (
        select 1 from employee_scopes sc where sc.employee_id = e.id and sc.scope_type = 'store' and sc.store_id = s.id
      ))
  ` as Recipient[];
}

async function createAttentionNotification(command: AttentionCommand, employeeId: string) {
  const text = inventorySyncAttentionText(command);
  const rows = await sql.query(`
    with current_commands as (${inventorySyncCommandRecheckSql})
    insert into os_notifications (recipient_employee_id, notification_type, title, message, href, source_key)
    select e.id, $2, $3, $4, $5, c."attentionKey"
    from current_commands c join stores s on s.id::text = c."storeId" and s.status = 'active'
    join employees e on e.id::text = $6 and e.status = 'active' and e.role in ('owner', 'manager', 'store_owner', 'store_terminal')
    where c.id = $7 and c."needsAttention" and c.status = $8
      and c.payload->'targets' = $9::jsonb and c.payload->'isAvailable' = $10::jsonb
      and (e.role in ('owner', 'manager') or exists (
        select 1 from employee_scopes sc where sc.employee_id = e.id and sc.scope_type = 'store' and sc.store_id = s.id
      ))
      and exists (select 1 from employee_sessions es where es.employee_id = e.id
        and es.session_version = e.session_version and es.revoked_at is null and (
          es.expires_at > now() or (e.role = 'store_terminal' and es.surface = 'store' and es.created_at > now() - interval '400 days')
        ))
    on conflict (recipient_employee_id, source_key) where source_key <> '' do update
    set title = excluded.title, message = excluded.message, href = excluded.href
    where os_notifications.title is distinct from excluded.title
      or os_notifications.message is distinct from excluded.message or os_notifications.href is distinct from excluded.href
    returning id::text, (xmax = 0) as created
  `, [command.storeId, notificationType, text.title, text.body, attentionHref(command), employeeId,
    command.id, command.status, JSON.stringify(command.payload.targets || []), JSON.stringify(command.payload.isAvailable ?? null)]);
  if (rows.length) await bounded(publishOsNotificationEvent(employeeId), 2_000).catch(() => undefined);
  return rows[0]?.created === true;
}

async function getWebSubscriptions(employeeId: string) {
  return await sql`
    select id::text, employee_id::text as "employeeId", endpoint, p256dh, auth from web_push_subscriptions
    where employee_id::text = ${employeeId} and revoked_at is null
  ` as WebSubscription[];
}

async function getNativeDevices(employeeId: string) {
  return await sql`
    select d.id::text, d.employee_id::text as "employeeId", d.session_id::text as "sessionId", d.provider, d.registration, d.language
    from store_order_push_devices d
    join employees e on e.id = d.employee_id and e.status = 'active'
    join employee_sessions es on es.id = d.session_id and es.employee_id = e.id and es.session_version = e.session_version
      and es.revoked_at is null and (
        es.expires_at > now() or (e.role = 'store_terminal' and es.surface = 'store' and es.created_at > now() - interval '400 days')
      )
    where d.employee_id::text = ${employeeId} and d.revoked_at is null
      and d.registration->>'inventorySyncVersion' = '1'
      and coalesce(d.registration->>'token', '') <> ''
  ` as OrderPushDevice[];
}

async function claimDelivery(job: DeliveryJob) {
  const token = randomUUID();
  const rows = await sql.query(`
    with current_commands as (${inventorySyncCommandRecheckSql})
    insert into menu_inventory_sync_alert_deliveries as delivery
      (command_id, recipient_employee_id, channel, destination_key, lease_token, lease_until)
    select c.id::uuid, e.id, $2, $3, $4::uuid, now() + $5 * interval '1 second'
    from current_commands c join stores s on s.id::text = c."storeId" and s.status = 'active'
    join employees e on e.id::text = $6 and e.status = 'active' and e.role in ('owner', 'manager', 'store_owner', 'store_terminal')
    where c.id = $7 and c."needsAttention" and c.status = $8
      and c.payload->'targets' = $9::jsonb
      and c.payload->'isAvailable' = $14::jsonb
      and (e.role in ('owner', 'manager') or exists (
        select 1 from employee_scopes sc where sc.employee_id = e.id and sc.scope_type = 'store' and sc.store_id = s.id
      ))
      and exists (select 1 from employee_sessions es where es.employee_id = e.id
        and es.session_version = e.session_version and es.revoked_at is null and (
          es.expires_at > now() or (e.role = 'store_terminal' and es.surface = 'store' and es.created_at > now() - interval '400 days')
        ))
      and (
        ($2 = 'web_push' and exists (
          select 1 from web_push_subscriptions w where w.id::text = $10 and w.employee_id = e.id and w.revoked_at is null and w.endpoint = $13
        )) or ($2 = 'fcm' and exists (
          select 1 from store_order_push_devices d join employee_sessions es on es.id = d.session_id and es.employee_id = d.employee_id
          where d.id::text = $10 and d.employee_id = e.id and d.revoked_at is null
            and d.registration->>'inventorySyncVersion' = '1'
            and d.registration->>'token' = $12
            and d.session_id::text = $11 and es.session_version = e.session_version and es.revoked_at is null
            and (es.expires_at > now() or (e.role = 'store_terminal' and es.surface = 'store' and es.created_at > now() - interval '400 days'))
        ))
      )
    on conflict (command_id, recipient_employee_id, channel, destination_key) do update
    set status = 'sending', lease_token = excluded.lease_token, lease_until = excluded.lease_until,
      attempt_count = delivery.attempt_count + 1, updated_at = now()
    where (delivery.status = 'failed' and delivery.next_attempt_at <= now())
      or (delivery.status = 'sending' and delivery.lease_until < now())
    returning lease_token::text
  `, [job.command.storeId, job.channel, job.destinationKey, token, deliveryLeaseSeconds,
    job.employeeId, job.command.id, job.command.status, JSON.stringify(job.command.payload.targets || []), job.destinationId,
    job.sessionId || "", job.registrationToken || "", job.endpoint || "", JSON.stringify(job.command.payload.isAvailable ?? null)]);
  return rows.length ? token : null;
}

async function finishDelivery(job: DeliveryJob, token: string, accepted: boolean, error = "") {
  await sql`
    update menu_inventory_sync_alert_deliveries
    set status = ${accepted ? "sent" : "failed"}, last_error = ${error},
      accepted_at = case when ${accepted} then now() else accepted_at end,
      next_attempt_at = now() + least(3600, 60 * power(2, least(attempt_count - 1, 6))) * interval '1 second',
      lease_until = now(), updated_at = now()
    where command_id::text = ${job.command.id} and recipient_employee_id::text = ${job.employeeId}
      and channel = ${job.channel} and destination_key = ${job.destinationKey} and lease_token = ${token}::uuid and status = 'sending'
  `;
}

async function sendWebAttention(command: AttentionCommand, subscription: WebSubscription) {
  const text = inventorySyncAttentionText(command);
  try {
    await webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({
      ...text, href: attentionHref(command), type: notificationType, deliveryKey: command.attentionKey,
      priority: command.payload?.isAvailable === true ? "normal" : "high", sentAt: new Date().toISOString()
    }), { timeout: webPushTimeoutMs, TTL: 300, urgency: command.payload?.isAvailable === true ? "normal" : "high" });
    await sql`
      update web_push_subscriptions set last_success_at = now(), last_error = null, updated_at = now()
      where id::text = ${subscription.id} and employee_id::text = ${subscription.employeeId} and endpoint = ${subscription.endpoint}
    `;
  } catch (error) {
    const statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;
    await sql`
      update web_push_subscriptions set last_error = ${`INVENTORY_SYNC_WEB_PUSH_${statusCode || "FAILED"}`},
        revoked_at = case when ${statusCode === 404 || statusCode === 410} then now() else revoked_at end, updated_at = now()
      where id::text = ${subscription.id} and employee_id::text = ${subscription.employeeId} and endpoint = ${subscription.endpoint}
    `;
    throw new Error(`INVENTORY_SYNC_WEB_PUSH_${statusCode || "FAILED"}`);
  }
}

async function sendNativeAttention(command: AttentionCommand, device: OrderPushDevice) {
  try {
    await bounded(sendOrderPush(device, {
      ...inventorySyncAttentionText(command, device.language), type: "store_inventory_sync", storeId: command.storeId,
      eventId: command.id, deliveryKey: command.attentionKey, expiresAt: String(Date.now() + 300_000),
      priority: command.payload?.isAvailable === true ? "normal" : "high", href: attentionHref(command)
    }, { ttlSeconds: 300 }), 27_000);
    await sql`
      update store_order_push_devices set last_success_at = now(), last_error = ''
      where id::text = ${device.id} and employee_id::text = ${device.employeeId} and session_id::text = ${device.sessionId}
        and registration->>'token' = ${device.registration.token || ""}
    `;
  } catch (error) {
    const code = error instanceof OrderPushTransportError ? error.message : "INVENTORY_SYNC_FCM_FAILED";
    await sql`
      update store_order_push_devices set last_error = ${code},
        revoked_at = case when ${error instanceof OrderPushTransportError && error.expired} then now() else revoked_at end
      where id::text = ${device.id} and employee_id::text = ${device.employeeId} and session_id::text = ${device.sessionId}
        and registration->>'token' = ${device.registration.token || ""}
    `;
    throw new Error(code);
  }
}

/** Best-effort dispatch only. Call from after()/cron; failure never changes command ACKs. */
export async function notifyInventorySyncAttention(storeId?: string) {
  const result = { scanned: 0, created: 0, delivered: 0, failed: 0, migrationRequired: false };
  const deadline = Date.now() + dispatchBudgetMs;
  try {
    const ready = await sql`select to_regclass('public.menu_inventory_sync_alert_deliveries') is not null as ready`;
    if (ready[0]?.ready !== true) return { ...result, migrationRequired: true };
    const commands = (await getInventorySyncAttentionCommands(storeId)).filter(command => command.needsAttention);
    result.scanned = commands.length;
    if (!commands.length) return result;
    const receipts = await sql`
      select command_id::text as id, bool_and(status = 'sent') as "allAccepted", min(next_attempt_at)::text as "nextAttemptAt",
        coalesce(jsonb_agg(jsonb_build_array(recipient_employee_id::text, channel, destination_key))
          filter (where status = 'sent'), '[]'::jsonb) as "sentDestinations"
      from menu_inventory_sync_alert_deliveries where command_id::text = any(${commands.map(command => command.id)})
      group by command_id
    ` as Array<{ id: string; allAccepted: boolean; nextAttemptAt: string; sentDestinations: Array<[string, DeliveryChannel, string]> }>;
    const sentDestinationKeys = new Set(receipts.flatMap(receipt => receipt.sentDestinations.map(
      ([employeeId, channel, destinationKey]) => [receipt.id, employeeId, channel, destinationKey].join(":"))));
    const notices = await sql`
      select source_key as "attentionKey", recipient_employee_id::text as "employeeId", title, message, href
      from os_notifications where notification_type = ${notificationType}
        and source_key = any(${commands.map(command => command.attentionKey)})
    ` as Array<{ attentionKey: string; employeeId: string; title: string; message: string; href: string }>;
    const noticesByCommand = new Map<string, Map<string, typeof notices[number]>>();
    for (const notice of notices) {
      const byRecipient = noticesByCommand.get(notice.attentionKey) ?? new Map();
      byRecipient.set(notice.employeeId, notice);
      noticesByCommand.set(notice.attentionKey, byRecipient);
    }
    const receiptByCommand = new Map(receipts.map(receipt => [receipt.id, receipt]));
    const queuePosition = (command: AttentionCommand) => {
      const receipt = receiptByCommand.get(command.id);
      if (!receipt) return noticesByCommand.has(command.attentionKey) ? 3 : 0;
      if (receipt.allAccepted) return 4;
      return Date.parse(receipt.nextAttemptAt) <= Date.now() ? 1 : 2;
    };
    // Missing eligible devices produce no receipts. Existing in-app warnings
    // still count as progress, so a bounded scan reaches unseen failures first.
    // Revisit these commands for newly registered devices before accepted jobs.
    commands.sort((a, b) => queuePosition(a) - queuePosition(b)
      || Number(a.payload?.isAvailable === true) - Number(b.payload?.isAvailable === true)
      || (queuePosition(a) === 0 ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : Date.parse(a.createdAt) - Date.parse(b.createdAt)));
    const webEnabled = Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY && process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
    if (webEnabled) webPush.setVapidDetails(process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:admin@foundr1.jp", process.env.WEB_PUSH_VAPID_PUBLIC_KEY!, process.env.WEB_PUSH_VAPID_PRIVATE_KEY!);
    const nativeEnabled = getOrderPushConfig().enabled && getOrderPushConfig().fcm;
    const recipientsByStore = new Map<string, Recipient[]>();
    const destinationsByEmployee = new Map<string, { web: WebSubscription[]; native: OrderPushDevice[] }>();
    async function dispatch(jobs: DeliveryJob[]) {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
        while (next < jobs.length && Date.now() < deadline) {
          const job = jobs[next++];
          try {
            // The claim includes the shared current-intent projection in the same
            // SQL statement. A resolved or newly covered target cannot claim a send.
            const token = await claimDelivery(job);
            if (!token) continue;
            try {
              await job.send(job.command);
              await finishDelivery(job, token, true);
              result.delivered++;
            } catch {
              result.failed++;
              // Raw provider errors, registration tokens and endpoints are not stored.
              await finishDelivery(job, token, false, "INVENTORY_SYNC_PUSH_FAILED");
            }
          } catch { result.failed++; }
        }
      }));
    }
    for (const command of commands) {
      if (Date.now() >= deadline) break;
      try {
        const jobs: DeliveryJob[] = [];
        let recipients = recipientsByStore.get(command.storeId);
        if (!recipients) { recipients = await getRecipients(command.storeId); recipientsByStore.set(command.storeId, recipients); }
        for (const recipient of recipients) {
          if (Date.now() >= deadline) break;
          const notice = noticesByCommand.get(command.attentionKey)?.get(recipient.id);
          const text = inventorySyncAttentionText(command);
          // An exact existing notice needs no write or repeated intent query.
          // Changed text and new recipients still use the atomic scope/intent
          // checks; every external delivery always goes through claimDelivery.
          if (!notice || notice.title !== text.title || notice.message !== text.body || notice.href !== attentionHref(command)) {
            if (await createAttentionNotification(command, recipient.id)) result.created++;
          }
          let destinations = destinationsByEmployee.get(recipient.id);
          if (!destinations) {
            const [web, native] = await Promise.all([webEnabled ? getWebSubscriptions(recipient.id) : [], nativeEnabled ? getNativeDevices(recipient.id) : []]);
            destinations = { web, native }; destinationsByEmployee.set(recipient.id, destinations);
          }
          // Accepted receipts need no repeated atomic claim. Bind the cache to
          // command, recipient, channel and exact destination; rotated bindings
          // remain new jobs and retain every claim-time authorization check.
          for (const subscription of destinations.web) {
            const destinationKey = hash(subscription.endpoint);
            if (sentDestinationKeys.has([command.id, recipient.id, "web_push", destinationKey].join(":"))) continue;
            jobs.push({ command, employeeId: recipient.id, channel: "web_push", destinationId: subscription.id, endpoint: subscription.endpoint, destinationKey, send: current => sendWebAttention(current, subscription) });
          }
          for (const device of destinations.native) {
            const destinationKey = hash(`inventory-v1:${device.id}:${device.sessionId}:${device.registration.token || ""}`);
            if (sentDestinationKeys.has([command.id, recipient.id, "fcm", destinationKey].join(":"))) continue;
            jobs.push({ command, employeeId: recipient.id, channel: "fcm", destinationId: device.id, sessionId: device.sessionId, registrationToken: device.registration.token || "", destinationKey, send: current => sendNativeAttention(current, device) });
          }
        }
        await dispatch(jobs);
      } catch { result.failed++; }
    }
    return result;
  } catch {
    return { ...result, failed: result.failed + 1 };
  }
}
