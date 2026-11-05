import { getPusher } from '../../../../../lib/order-realtime';
import { authorizeHqAlertStore, hqJson } from '../../../../../lib/store-hq-alerts';
import { hqAlertUuid } from '../../../../../lib/store-hq-alert-policy';
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const channel = String(form?.get('channel_name') || ''), socket = String(form?.get('socket_id') || '');
  const storeId = channel.replace(/^private-store-hq-alerts-/, '');
  if (!channel.startsWith('private-store-hq-alerts-') || !hqAlertUuid.test(storeId) || !/^\d+\.\d+$/.test(socket)) return hqJson({ error: '不正な接続です。' }, 400);
  const auth = await authorizeHqAlertStore(storeId); if (auth.error) return auth.error;
  const pusher = getPusher();
  return pusher ? hqJson(pusher.authorizeChannel(socket, channel)) : hqJson({ error: 'Realtime unavailable' }, 503);
}
