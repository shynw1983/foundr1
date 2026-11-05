import { redirect } from 'next/navigation';
import { requireMasterOsSession } from '../../../../lib/api-auth';
import { HqAlertConsole } from './HqAlertConsole';
export const dynamic = 'force-dynamic';
export default async function HqAlertsPage() {
  const session = await requireMasterOsSession();
  if (!session) redirect('/os');
  return <HqAlertConsole employeeId={session.id} />;
}
