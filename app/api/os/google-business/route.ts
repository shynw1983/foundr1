import { dispatchGoogleHours } from '../../../../lib/google-business-hours-dispatch';
import { createHash, randomBytes } from 'node:crypto';
import { requireGoogleBusinessAccess, gbpJson, googleBusinessSameOrigin } from '../../../../lib/google-business-access';
import { googleBusinessConfig, googleAccessToken, listGoogleLocations, getGoogleLocation, sealGoogleSecret, gbpScope } from '../../../../lib/google-business-client';
import { sql } from '../../../../lib/db';
import { writeAuditLog } from '../../../../lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request) {
  const url = new URL(request.url);
  const storeId = url.searchParams.get('storeId') ?? '';
  const access = await requireGoogleBusinessAccess(storeId);
  if (access.error) return access.error;
  try {
    let configured = true;
    try { googleBusinessConfig(); } catch { configured = false; }
    const connections = await sql`select revision,enabled,location_name as "locationName",location_title as "locationTitle",preparation_minutes as "preparationMinutes",cleanup_minutes as "cleanupMinutes",token_ciphertext is not null as connected from google_business_connections where store_id::text=${storeId}`;
    if (url.searchParams.get('locations')==='1') {
      if (!configured || !connections[0]?.connected) return gbpJson({ error: 'Google アカウントを連携してください。' }, 409);
      const privateRows = await sql`select token_ciphertext from google_business_connections where store_id::text=${storeId}`;
      const token = await googleAccessToken(storeId, String(privateRows[0].token_ciphertext));
      return gbpJson({ locations: await listGoogleLocations(token) });
    }
    const jobs = await sql`select id::text,schedule_month as month,work_date::text as date,status,attempts,last_error as "lastError",synced_at as "syncedAt",created_at as "createdAt" from google_business_hours_jobs where store_id::text=${storeId} order by (status in ('pending','failed','conflict')) desc,sequence desc limit 12`;
    const [queue] = await sql`
      select count(*) filter(where j.status in ('pending','failed'))::int as "resumable",
        count(*) filter(where j.status='conflict')::int as "conflicts"
      from google_business_hours_jobs j
      join google_business_connections c on c.store_id=j.store_id and c.enabled and c.revision=j.connection_revision
      join timecard_schedule_days d on d.store_id=j.store_id and d.work_date=j.work_date
        and d.revision=j.day_revision and d.confirmed_at is not null and not d.needs_refresh
      where j.store_id::text=${storeId} and j.status in ('pending','failed','conflict')
        and not exists(select 1 from google_business_hours_jobs newer where newer.store_id=j.store_id
          and newer.work_date=j.work_date and newer.sequence>j.sequence)
    `;
    return gbpJson({ configured, queue, connection: connections[0] ?? { revision: 0, enabled: false, connected: false, preparationMinutes: null, cleanupMinutes: null, locationName: null }, jobs });
  } catch { return gbpJson({ error: 'Google 連携を読み込めませんでした。環境設定と移行状況を確認してください。' }, 503); }
}
export async function POST(request: Request) {
  if (!googleBusinessSameOrigin(request)) return gbpJson({ error: 'このリクエストは許可されていません。' }, 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.storeId !== 'string') return gbpJson({ error: '店舗を選択してください。' }, 400);
  const storeId: string = body.storeId;
  const access = await requireGoogleBusinessAccess(storeId);
  if (access.error) return access.error;
  try {
    if (body.action==='connect') {
      const config = googleBusinessConfig();
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(state).digest('hex');
      await sql`delete from google_business_oauth_states where expires_at<now()`;
      await sql`insert into google_business_oauth_states(state_hash,employee_id,session_id,store_id,verifier_ciphertext) values(${hash},${access.session.id}::uuid,${access.session.sessionId}::uuid,${storeId}::uuid,${sealGoogleSecret(verifier,hash)})`;
      const query = new URLSearchParams({ client_id: config.clientId,redirect_uri: config.redirectUri,response_type: 'code',scope: gbpScope,access_type: 'offline',prompt: 'consent select_account',state,code_challenge: createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256' });
      return gbpJson({ url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` });
    }
    if (body.action==='resume') {
      const rows = await sql`
        update google_business_hours_jobs j set status='pending',attempts=0,next_attempt_at=now(),last_error=null
        from google_business_connections c, timecard_schedule_days d
        where j.store_id::text=${storeId} and j.status in ('pending','failed')
          and c.store_id=j.store_id and c.enabled and c.revision=j.connection_revision
          and (c.lease_until is null or c.lease_until<now())
          and d.store_id=j.store_id and d.work_date=j.work_date and d.revision=j.day_revision
          and d.confirmed_at is not null and not d.needs_refresh
          and not exists(select 1 from google_business_hours_jobs newer where newer.store_id=j.store_id
            and newer.work_date=j.work_date and newer.sequence>j.sequence)
        returning j.id
      `;
      if (!rows.length) return gbpJson({ error: '同期できる未処理の営業予定がありません。同期状態を更新してください。' },409);
      dispatchGoogleHours(storeId, true);
    } else if (body.action==='retry') {
      if (typeof body.jobId!=='string') return gbpJson({ error: '同期履歴を選択してください。' },400);
      const rows = await sql`
        update google_business_hours_jobs j set status='pending',attempts=0,next_attempt_at=now(),last_error=null
        from google_business_connections c where j.id::text=${body.jobId} and j.store_id::text=${storeId}
        and c.store_id=j.store_id and c.enabled and c.revision=j.connection_revision
        and exists(select 1 from timecard_schedule_days d where d.store_id=j.store_id and d.work_date=j.work_date and d.revision=j.day_revision and d.confirmed_at is not null and not d.needs_refresh)
        and j.status in ('pending','failed','conflict') and (c.lease_until is null or c.lease_until<now())
        and not exists(select 1 from google_business_hours_jobs n where n.store_id=j.store_id and n.work_date=j.work_date and n.sequence>j.sequence) returning j.id
      `;
      if (!rows[0]) return gbpJson({ error: '再試行できません。設定と最新の公開内容を確認してください。' },409);
      dispatchGoogleHours(storeId, true);
    } else if (body.action==='save' || body.action==='disconnect') {
      const disconnect = body.action==='disconnect';
      if (!Number.isInteger(body.revision) || typeof body.enabled!=='boolean') return gbpJson({ error: '設定を再読み込みしてください。' },400);
      const privateRows = await sql`select token_ciphertext,location_name,enabled,revision from google_business_connections where store_id::text=${storeId}`;
      const connection = privateRows[0];
      const locationName = disconnect ? null : String(body.locationName ?? '');
      if (!disconnect && connection?.revision === body.revision &&
        connection.enabled === body.enabled && connection.location_name === (locationName || null)) {
        return gbpJson({ ok: true, unchanged: true });
      }
      let title: string | null = null;
      if (!disconnect && locationName) {
        if (!connection?.token_ciphertext) return gbpJson({ error: 'Google アカウントを連携してください。' },409);
        const token = await googleAccessToken(storeId,String(connection.token_ciphertext));
        const locations = await listGoogleLocations(token);
        const selected = locations.find(location => location.name===locationName);
        if (!selected) return gbpJson({ error: 'Google の店舗を選択してください。' },400);
        const live = await getGoogleLocation(token,locationName);
        if (body.enabled && !live.regularHours?.periods?.length) return gbpJson({ error: '先に Google の通常営業時間を設定してください。' },409);
        title = selected.title;
      }
      if (!disconnect && body.enabled && !locationName) return gbpJson({ error: 'Google の店舗を選択してください。' },400);
      const rows = await sql`
        insert into google_business_connections(store_id,preparation_minutes,cleanup_minutes,updated_by)
        select ${storeId}::uuid,${null}::integer,${null}::integer,${access.session.id}::uuid where ${body.revision===0 && !body.enabled && !locationName && !disconnect}
        on conflict(store_id) do nothing returning revision
      `;
      if (!rows[0]) {
        const updated = await sql`
          update google_business_connections set enabled=${!disconnect && body.enabled},location_name=${locationName || null},location_title=${title},
            token_ciphertext=case when ${disconnect} then null else token_ciphertext end,
            applied_dates=case when location_name is distinct from ${locationName || null} then '{}'::jsonb else applied_dates end,
            revision=revision+1,updated_by=${access.session.id}::uuid,updated_at=now()
          where store_id::text=${storeId} and revision=${body.revision} and (lease_until is null or lease_until<now()) returning revision
        `;
        if (!updated[0]) return gbpJson({ error: '設定が更新されたか同期中です。再読み込みしてください。' },409);
      }
    } else return gbpJson({ error: '操作を確認してください。' },400);
    if (body.action==='disconnect') await sql`delete from google_business_oauth_states where store_id::text=${storeId}`;
    await writeAuditLog({ actorEmployeeId:access.session.id,action:`google_business.${body.action}`,targetType:'store',targetId:storeId,metadata:{ jobId:body.jobId ?? null,enabled:body.enabled ?? null },request });
    return gbpJson({ ok:true });
  } catch (error) {
    const message = error instanceof Error && /^(Google|準備)/.test(error.message) ? error.message : 'Google 連携を保存できませんでした。設定を確認してください。';
    return gbpJson({ error:message },400);
  }
}
