import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireGoogleBusinessAccess, gbpJson } from '../../../../../lib/google-business-access';
import { googleBusinessConfig, exchangeGoogleToken, openGoogleSecret, sealGoogleSecret, gbpScope } from '../../../../../lib/google-business-client';
import { sql } from '../../../../../lib/db';
import { writeAuditLog } from '../../../../../lib/audit-log';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const hash = createHash('sha256').update(url.searchParams.get('state') ?? '').digest('hex');
  const states = await sql`select store_id::text as "storeId",employee_id::text as "employeeId",session_id::text as "sessionId" from google_business_oauth_states where state_hash=${hash} and expires_at>now()`;
  if (!states[0]) return gbpJson({ error:'Google の認証をやり直してください。' },400);
  const state = states[0];
  const access = await requireGoogleBusinessAccess(String(state.storeId));
  if (access.error) return access.error;
  if (access.session.id!==state.employeeId || access.session.sessionId!==state.sessionId) return gbpJson({ error:'認証を開始したアカウントで操作してください。' },403);
  const consumed = await sql`delete from google_business_oauth_states where state_hash=${hash} and expires_at>now() returning verifier_ciphertext`;
  if (!consumed[0]) return gbpJson({ error:'Google の認証をやり直してください。' },400);
  const destination = new URL('/os/timecard/schedule#google-business-settings', googleBusinessConfig().redirectUri);
  try {
    if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('denied');
    const token = await exchangeGoogleToken({ grant_type:'authorization_code',code:url.searchParams.get('code')!,redirect_uri:googleBusinessConfig().redirectUri,code_verifier:openGoogleSecret(String(consumed[0].verifier_ciphertext),hash) });
    if (!token.refresh_token || !token.scope?.split(' ').includes(gbpScope)) throw new Error('scope');
    const rows = await sql`
      insert into google_business_connections(store_id,token_ciphertext,updated_by) values(${state.storeId}::uuid,${sealGoogleSecret(token.refresh_token,String(state.storeId))},${access.session.id}::uuid)
      on conflict(store_id) do update set token_ciphertext=excluded.token_ciphertext,enabled=false,location_name=null,location_title=null,applied_dates='{}'::jsonb,revision=google_business_connections.revision+1,updated_by=excluded.updated_by,updated_at=now()
      where google_business_connections.lease_until is null or google_business_connections.lease_until<now() returning store_id
    `;
    if (!rows[0]) throw new Error('busy');
    await writeAuditLog({actorEmployeeId:access.session.id,action:'google_business.connected',targetType:'store',targetId:String(state.storeId),metadata:{},request});
    destination.searchParams.set('googleBusiness','connected');
  } catch { destination.searchParams.set('googleBusiness','failed'); }
  destination.searchParams.set('storeId',String(state.storeId));
  return NextResponse.redirect(destination,{ headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'} });
}
