import { scheduleUberSourceScans } from '../../../../lib/uber-menu-source-sync';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({error:'Unauthorized'},{status:401});
  return Response.json(await scheduleUberSourceScans(),{headers:{'Cache-Control':'no-store'}});
}
