import { randomUUID } from 'node:crypto';
import { sql } from './db';
import { googleAccessToken, getGoogleLocation, patchGoogleHours } from './google-business-client';
import { mergeSpecialHours, canonicalPeriods, periodsByDate, dateKey, HoursConflict, type GbpPeriod } from './google-business-hours-policy';

export async function runGoogleHoursJob(storeId: string) {
  const leaseId = randomUUID();
  const claimed = await sql`
    update google_business_connections set lease_id=${leaseId}::uuid,lease_until=now()+interval '3 minutes'
    where store_id::text=${storeId} and enabled and (lease_until is null or lease_until<now())
      and exists(select 1 from stores where stores.id=google_business_connections.store_id and stores.status='active')
    returning token_ciphertext as token,location_name as location,revision,applied_dates as owned
  `;
  if (!claimed[0]) return { status: 'idle' };
  let jobId = '';
  try {
    await sql`
      update google_business_hours_jobs j set status='superseded'
      where j.store_id::text=${storeId} and j.status in ('pending','failed','conflict') and (
        j.connection_revision<>${claimed[0].revision} or j.work_date is null or not exists(
          select 1 from timecard_schedule_days d where d.store_id=j.store_id and d.work_date=j.work_date
          and d.revision=j.day_revision and d.confirmed_at is not null and not d.needs_refresh and d.business_status in('open','closed') and d.business_periods is not null
        ) or exists(
          select 1 from google_business_hours_jobs newer where newer.store_id=j.store_id and newer.work_date=j.work_date
          and newer.sequence>j.sequence
        )
      )
    `;
    const jobs = await sql`
      select j.id::text,j.schedule_month as month,j.intended_periods as intended,j.work_date::text as date,j.day_revision as revision,p.business_periods as periods
      from google_business_hours_jobs j join timecard_shift_publications p on p.id=j.publication_id
      where j.store_id::text=${storeId} and j.status in ('pending','failed') and j.attempts<5 and j.next_attempt_at<=now()
      order by j.sequence limit 1
    `;
    const job = jobs[0];
    if (!job) return { status: 'idle' };
    jobId = String(job.id);
    await sql`update google_business_hours_jobs set attempts=attempts+1 where id=${jobId}::uuid`;
    const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(!Array.isArray(job.periods))throw new HoursConflict('営業日カレンダーを再確定してください。');
    const desired = (job.periods as GbpPeriod[]).filter(period => dateKey(period.startDate)>=today);
    if (!desired.length) throw new HoursConflict('同期対象の日付がありません。シフトまたは休業日を確認して再公開してください。');
    const connection = claimed[0];
    const token = await googleAccessToken(storeId, String(connection.token));
    const current = await getGoogleLocation(token, String(connection.location));
    if (!current.regularHours?.periods?.length) throw new HoursConflict('先に Google の通常営業時間を設定してください。');
    const actual = current.specialHours?.specialHourPeriods ?? [];
    // Recover an accepted PATCH whose HTTP response or local DB acknowledgement was lost.
    const recovering = Array.isArray(job.intended) && canonicalPeriods(actual) === canonicalPeriods(job.intended as GbpPeriod[]);
    const merged = recovering
      ? { periods: actual, owned: { ...connection.owned as Record<string,GbpPeriod[]>, ...periodsByDate(desired) } }
      : mergeSpecialHours(actual, desired, connection.owned as Record<string,GbpPeriod[]>);
    if (!recovering && canonicalPeriods(actual)!==canonicalPeriods(merged.periods)) {
      await sql`update google_business_hours_jobs set intended_periods=${JSON.stringify(merged.periods)}::jsonb where id=${jobId}::uuid`;
      const valid=await sql`select d.store_id from timecard_schedule_days d join google_business_connections c on c.store_id=d.store_id
        where d.store_id::text=${storeId} and d.work_date=${job.date}::date and d.revision=${job.revision}
        and d.confirmed_at is not null and not d.needs_refresh and d.business_status in('open','closed') and d.business_periods is not null
        and c.lease_id=${leaseId}::uuid and c.lease_until>now() and c.enabled and c.revision=${connection.revision}`;
      if(!valid[0])throw new HoursConflict('シフトが変更されました。最新の確定内容を確認してください。');
      await patchGoogleHours(token, String(connection.location), merged.periods);
    }
    const readback = await getGoogleLocation(token, String(connection.location));
    if (canonicalPeriods(readback.specialHours?.specialHourPeriods ?? [])!==canonicalPeriods(merged.periods)) throw new Error('Google の保存結果を確認できませんでした。');
    await sql.transaction([
      sql`update google_business_connections set applied_dates=${JSON.stringify(merged.owned)}::jsonb where store_id::text=${storeId} and lease_id=${leaseId}::uuid`,
      sql`update google_business_hours_jobs set status='synced',synced_at=now(),last_error=null where id=${jobId}::uuid`
    ]);
    return { status: 'synced' };
  } catch (error) {
    if (!jobId) throw error;
    const status = error instanceof HoursConflict ? 'conflict' : 'failed';
    const message = error instanceof Error && (error instanceof HoursConflict || /^(Google|準備|確定|開始|対象|日付|休業|前日)/.test(error.message)) ? error.message : 'Google との通信に失敗しました。再試行してください。';
    await sql`update google_business_hours_jobs set status=${status},last_error=${message},next_attempt_at=now()+interval '5 minutes' * power(2,least(attempts,4)) where id=${jobId}::uuid`;
    return { status };
  } finally {
    await sql`update google_business_connections set lease_id=null,lease_until=null where store_id::text=${storeId} and lease_id=${leaseId}::uuid`;
  }
}
export async function sweepGoogleHours(deadline: number, onlyStoreId?: string) {
  const deferredStores: string[] = [];
  const results = [];
  // A half-month can contain 16 days. Leave room for the last job's HTTP timeouts.
  for (let attempt = 0; attempt < 16 && Date.now() < deadline; attempt++) {
    const rows = await sql`
      select j.store_id::text from google_business_hours_jobs j
      join google_business_connections c on c.store_id=j.store_id
      join stores s on s.id=j.store_id
      where (${onlyStoreId??null}::text is null or j.store_id::text=${onlyStoreId??null})
        and c.enabled and s.status='active' and (c.lease_until is null or c.lease_until<now())
        and j.status in ('pending','failed') and j.attempts<5 and j.next_attempt_at<=now()
        and not (j.store_id::text=any(${deferredStores}::text[]))
      order by j.sequence limit 1
    `;
    if (!rows[0] || Date.now() >= deadline) break;
    const storeId = String(rows[0].store_id);
    const result = await runGoogleHoursJob(storeId);
    results.push(result);
    if (result.status === 'idle' || result.status === 'failed') deferredStores.push(storeId);
  }
  return results;
}
