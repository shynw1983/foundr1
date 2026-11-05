import { sql } from "./db";
import { sendPurchaseOrderLarkNotification } from "./lark";
import { publishOsNotificationEvent } from "./notification-realtime";

/** The durable in-app notification already committed with the order. Optional delivery cannot undo it. */
export async function dispatchReplenishmentDemandNotification(notificationId: string) {
  const rows=await sql`select notifications.recipient_employee_id::text as "buyerId",notifications.href,
    employees.name as "buyerName",employees.lark_open_id as "larkOpenId",employees.lark_user_id as "larkUserId",
    orders.order_no as "orderNo",orders.deadline_label as deadline,orders.requested_item_count as "itemCount",stores.name as "storeName"
    from os_notifications notifications join employees on employees.id=notifications.recipient_employee_id
    join purchase_orders orders on notifications.href='/os/procurement?order='||orders.order_no
    join stores on stores.id=orders.store_id where notifications.id::text=${notificationId} and notifications.notification_type='new_order'`;
  const row=rows[0];if(!row)return;
  await publishOsNotificationEvent(String(row.buyerId)).catch(()=>undefined);
  try {
    const result=await sendPurchaseOrderLarkNotification({larkOpenId:row.larkOpenId as string|null,larkUserId:row.larkUserId as string|null},
      {orderNo:String(row.orderNo),storeName:String(row.storeName),itemCount:Number(row.itemCount),deadline:String(row.deadline ?? ''),buyerName:String(row.buyerName),href:String(row.href)});
    if(result.delivered)await sql`update os_notifications set lark_sent_at=now(),lark_error=null where id::text=${notificationId}`;
    else if(!result.ok)await sql`update os_notifications set lark_error=${result.error} where id::text=${notificationId}`;
  } catch {
    await sql`update os_notifications set lark_error='notification_delivery_failed' where id::text=${notificationId}`.catch(()=>undefined);
  }
}
