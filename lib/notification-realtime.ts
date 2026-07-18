import Pusher from "pusher";

let notificationPusherClient: Pusher | null = null;

function getNotificationPusher() {
  if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET || !process.env.PUSHER_CLUSTER) {
    return null;
  }

  if (!notificationPusherClient) {
    notificationPusherClient = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER,
      useTLS: true
    });
  }

  return notificationPusherClient;
}

export async function publishOsNotificationEvent(employeeId: string) {
  const pusher = getNotificationPusher();
  if (!pusher || !employeeId) return;

  await pusher.trigger(`private-os-notifications-${employeeId}`, "notification.updated", {
    updatedAt: new Date().toISOString()
  });
}
