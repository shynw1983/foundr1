import { sql } from "./db";
import { posPreparationTaskSql } from "./pos-production-task-filter";
import type { PosFulfillmentAction, PosFulfillmentTask, PosFulfillmentUndo } from "./pos-fulfillment-policy";
import { posFulfillmentUndoSeconds } from "./pos-fulfillment-policy";

export async function readPosFulfillmentTasks(storeId: string): Promise<PosFulfillmentTask[]> {
  const rows = await sql`
    select tasks.id::text, orders.id::text as "orderId", coalesce(tasks.order_item_id::text,'') as "orderItemId",
      coalesce(nullif(tasks.pickup_code,''),orders.pickup_code) as "pickupCode",
      case when tasks.status='ready' then 'ready' else 'waiting' end as status,
      tasks.status as "productionStatus",
      md5(concat_ws('|',tasks.status,tasks.started_at::text,tasks.ready_at::text,tasks.handed_off_at::text,tasks.updated_at::text)) as version,
      tasks.item_summary as "itemSummary",
      concat_ws(' / ',nullif(trim(orders.customer_summary->>'note'),''),
        case when tasks.order_item_id is not null and trim(coalesce(items.preparation_note,''))<>trim(coalesce(orders.customer_summary->>'note',''))
          then nullif(trim(items.preparation_note),'') end) as note,
      orders.created_at::text as "createdAt", coalesce(tasks.ready_at::text,'') as "readyAt",
      coalesce(orders.customer_summary->>'diningSeatLabel','') as "tableLabel",
      coalesce(orders.customer_summary->>'orderType','') as "orderType",
      coalesce(items.quantity,1)::int as quantity
    from order_production_tasks tasks
    join store_customer_orders orders on orders.id=tasks.order_id and orders.store_id=tasks.store_id
    left join store_customer_order_items items on items.id=tasks.order_item_id and items.order_id=orders.id
    where orders.store_id::text=${storeId} and orders.order_source='store_pos'
      and orders.payment_status in ('paid','partial_refunded') and orders.status in ('new','preparing','ready')
      and tasks.status in ('new','preparing','ready') and tasks.handed_off_at is null
      and ${sql.unsafe(posPreparationTaskSql('orders', 'tasks'))}
    order by orders.created_at,tasks.created_at,tasks.id
    limit 300
  ` as PosFulfillmentTask[];
  return rows.map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), readyAt: row.readyAt ? new Date(row.readyAt).toISOString() : "" }));
}

type MutationInput = {
  storeId: string; taskId: string; action: PosFulfillmentAction; expectedVersion: string;
  mutationId: string; undoToken: string; actorId: string; baseSessionId: string;
  writeGuards?: ReturnType<typeof sql>[];
};
type MutationRow = { orderId: string; taskId: string; pickupCode: string; version: string; replayed: boolean; undo: PosFulfillmentUndo | null };

/** Lock the parent before reading task/refund state. All sibling actions share this lock. */
export async function mutatePosFulfillment(input: MutationInput): Promise<MutationRow | null> {
  const statements = [
    // Match checkout/refund lock ordering: operator credential/session, then the business order.
    ...(input.writeGuards ?? []),
    sql`select orders.id from store_customer_orders orders join order_production_tasks tasks on tasks.order_id=orders.id
      where tasks.id::text=${input.taskId} and orders.store_id::text=${input.storeId} and tasks.store_id=orders.store_id
        and orders.order_source='store_pos' for update of orders`,
    sql`with target as materialized (
      select tasks.*, orders.status as order_status, orders.customer_summary,
        coalesce(nullif(tasks.pickup_code,''),orders.pickup_code) as code,
        md5(concat_ws('|',tasks.status,tasks.started_at::text,tasks.ready_at::text,tasks.handed_off_at::text,tasks.updated_at::text)) as version,
        coalesce(orders.customer_summary->'posFulfillmentTasks'->tasks.id::text,'{}'::jsonb) as previous,
        (select md5(concat_ws('::',string_agg(concat_ws('|',siblings.id::text,siblings.status,siblings.started_at::text,siblings.ready_at::text,
          siblings.handed_off_at::text,siblings.updated_at::text,coalesce(sibling_items.refund_status,'')),',' order by siblings.id),
          (select string_agg(concat_ws('|',all_items.id::text,all_items.refund_status),',' order by all_items.id)
            from store_customer_order_items all_items where all_items.order_id=orders.id)))
          from order_production_tasks siblings left join store_customer_order_items sibling_items on sibling_items.id=siblings.order_item_id
          where siblings.order_id=orders.id) as taskset_version,
        orders.customer_summary#>>'{posFulfillment,lastMutationId}' as last_mutation_id,
        clock_timestamp() as action_at
      from order_production_tasks tasks join store_customer_orders orders on orders.id=tasks.order_id
      left join store_customer_order_items items on items.id=tasks.order_item_id and items.order_id=orders.id
      where tasks.id::text=${input.taskId} and orders.store_id::text=${input.storeId} and tasks.store_id=orders.store_id
        and orders.order_source='store_pos' and orders.payment_status in ('paid','partial_refunded')
        and orders.status in ('new','preparing','ready','completed')
        and ${sql.unsafe(posPreparationTaskSql('orders', 'tasks'))}
    ), eligible as materialized (
      select * from target where version=${input.expectedVersion} and coalesce(previous->>'mutationId','')<>${input.mutationId}
        and (
          (${input.action}='ready' and order_status<>'completed' and status in ('new','preparing') and handed_off_at is null)
          or (${input.action}='handoff' and order_status<>'completed' and status='ready' and handed_off_at is null)
          or (${input.action}='recall' and order_status<>'completed' and status='ready' and handed_off_at is null)
          or (${input.action}='undo' and previous->>'mutationId'=${input.undoToken}
            and last_mutation_id=${input.undoToken} and previous->>'action' in ('ready','handoff')
            and previous->>'actorId'=${input.actorId} and previous->>'baseSessionId'=${input.baseSessionId}
            and (previous->>'expiresAt')::timestamptz>action_at
            and previous->>'afterVersion'=version
            and previous->>'afterTaskSetVersion'=taskset_version
            and ((previous->>'action'='ready' and status='ready' and handed_off_at is null)
              or (previous->>'action'='handoff' and status='ready' and handed_off_at is not null)))
        )
    ), changed as (
      update order_production_tasks tasks set
        status=case when ${input.action}='undo' then eligible.previous#>>'{before,status}'
          when ${input.action}='ready' then 'ready' else tasks.status end,
        started_at=case when ${input.action}='undo' then (eligible.previous#>>'{before,startedAt}')::timestamptz
          when ${input.action}='ready' then coalesce(tasks.started_at,eligible.action_at) else tasks.started_at end,
        ready_at=case when ${input.action}='undo' then (eligible.previous#>>'{before,readyAt}')::timestamptz
          when ${input.action}='ready' then eligible.action_at else tasks.ready_at end,
        completed_by=case when ${input.action}='undo' then (eligible.previous#>>'{before,completedBy}')::uuid
          when ${input.action}='ready' then ${input.actorId}::uuid else tasks.completed_by end,
        handed_off_at=case when ${input.action}='undo' then (eligible.previous#>>'{before,handedOffAt}')::timestamptz
          when ${input.action}='handoff' then eligible.action_at else tasks.handed_off_at end,
        updated_at=eligible.action_at
      from eligible where tasks.id=eligible.id
      returning tasks.*
    ), effective as materialized (
      select tasks.order_id,
        case when tasks.id=changed.id then changed.status else tasks.status end as status,
        case when tasks.id=changed.id then changed.handed_off_at else tasks.handed_off_at end as handed_off_at
      from changed join order_production_tasks tasks on tasks.order_id=changed.order_id
      join store_customer_orders active_orders on active_orders.id=tasks.order_id
      left join store_customer_order_items items on items.id=tasks.order_item_id
      where ${sql.unsafe(posPreparationTaskSql('active_orders', 'tasks'))}
    ), aggregate_status as (
      select order_id, case when bool_and(handed_off_at is not null) then 'completed'
        when bool_and(status='ready') then 'ready'
        when bool_or(status in ('preparing','ready')) then 'preparing' else 'new' end as next_status
      from effective group by order_id
    ), facts as materialized (
      select changed.*,eligible.code,eligible.action_at,
        md5(concat_ws('|',changed.status,changed.started_at::text,changed.ready_at::text,changed.handed_off_at::text,changed.updated_at::text)) as after_version,
        (select md5(concat_ws('::',string_agg(concat_ws('|',siblings.id::text,
          case when siblings.id=changed.id then changed.status else siblings.status end,
          case when siblings.id=changed.id then changed.started_at::text else siblings.started_at::text end,
          case when siblings.id=changed.id then changed.ready_at::text else siblings.ready_at::text end,
          case when siblings.id=changed.id then changed.handed_off_at::text else siblings.handed_off_at::text end,
          case when siblings.id=changed.id then changed.updated_at::text else siblings.updated_at::text end,
          coalesce(sibling_items.refund_status,'')),',' order by siblings.id),
          (select string_agg(concat_ws('|',all_items.id::text,all_items.refund_status),',' order by all_items.id)
            from store_customer_order_items all_items where all_items.order_id=changed.order_id)))
          from order_production_tasks siblings left join store_customer_order_items sibling_items on sibling_items.id=siblings.order_item_id
          where siblings.order_id=changed.order_id) as after_taskset_version,
        jsonb_build_object('status',eligible.status,'startedAt',eligible.started_at,'readyAt',eligible.ready_at,
          'completedBy',eligible.completed_by,'handedOffAt',eligible.handed_off_at) as before,
        coalesce((eligible.previous->>'callVersion')::bigint,0)
          + case when ${input.action} in ('ready','recall') then 1 else 0 end as call_version
      from changed join eligible on eligible.id=changed.id
    ), saved as (
      update store_customer_orders orders set
        status=aggregate_status.next_status,
        completed_at=case when aggregate_status.next_status='completed' then coalesce(orders.completed_at,facts.action_at) else null end,
        preparing_at=case when aggregate_status.next_status='new' then null else coalesce(orders.preparing_at,facts.action_at) end,
        ready_at=case when aggregate_status.next_status='ready' then coalesce(orders.ready_at,facts.action_at) else null end,
        inventory_first_prepared_at=case when ${input.action}='ready'
          then coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at,facts.started_at,facts.action_at)
          else orders.inventory_first_prepared_at end,
        inventory_preparation_source_snapshot=case when ${input.action}='ready' then
          jsonb_set(coalesce(orders.inventory_preparation_source_snapshot,orders.inventory_source_snapshot),'{preparationEvidence}',
            jsonb_build_object('kind',coalesce(orders.inventory_preparation_source_snapshot#>>'{preparationEvidence,kind}','internal_preparation'),
              'occurredAt',coalesce(orders.inventory_first_prepared_at,orders.preparing_at,orders.ready_at,orders.completed_at,facts.started_at,facts.action_at)),true)
          else orders.inventory_preparation_source_snapshot end,
        customer_summary=orders.customer_summary || jsonb_build_object(
          'posFulfillment',jsonb_build_object('lastMutationId',${input.mutationId}::text),
          'posFulfillmentTasks',coalesce(orders.customer_summary->'posFulfillmentTasks','{}'::jsonb) || jsonb_build_object(facts.id::text,
            jsonb_build_object('mutationId',${input.mutationId}::text,'action',${input.action}::text,'expectedVersion',${input.expectedVersion}::text,
              'undoToken',${input.undoToken}::text,'actorId',${input.actorId}::text,'baseSessionId',${input.baseSessionId}::text,
              'expiresAt',facts.action_at+make_interval(secs=>${posFulfillmentUndoSeconds}),
              'before',facts.before,'afterVersion',facts.after_version,'afterTaskSetVersion',facts.after_taskset_version,
              'callVersion',facts.call_version))),
        updated_at=facts.action_at
      from facts join aggregate_status on aggregate_status.order_id=facts.order_id
      where orders.id=facts.order_id
      returning orders.id,orders.customer_summary
    )
    select saved.id::text as "orderId", facts.id::text as "taskId",facts.code as "pickupCode",facts.after_version as version,false as replayed,
      case when ${input.action} in ('ready','handoff') then jsonb_build_object(
        'token',${input.mutationId}::text,'expiresAt',facts.action_at+make_interval(secs=>${posFulfillmentUndoSeconds}),
        'taskId',facts.id::text,'pickupCode',facts.code,'action',${input.action}::text,'version',facts.after_version) else null end as undo
    from saved join facts on facts.order_id=saved.id
    union all
    select target.order_id::text,target.id::text,target.code,target.version,true,
      case when ${input.action} in ('ready','handoff') and target.last_mutation_id=${input.mutationId}
        and (target.previous->>'expiresAt')::timestamptz>target.action_at then jsonb_build_object(
          'token',${input.mutationId}::text,'expiresAt',target.previous->>'expiresAt','taskId',target.id::text,
          'pickupCode',target.code,'action',${input.action}::text,'version',target.version) else null end
    from target where not exists(select 1 from saved)
      and target.previous->>'mutationId'=${input.mutationId} and target.previous->>'action'=${input.action}
      and target.previous->>'expectedVersion'=${input.expectedVersion} and target.previous->>'undoToken'=${input.undoToken}
      and target.previous->>'actorId'=${input.actorId} and target.previous->>'baseSessionId'=${input.baseSessionId}
      and target.previous->>'afterVersion'=target.version`
  ];
  const results = await sql.transaction(statements);
  return results[results.length - 1]?.[0] as MutationRow | undefined ?? null;
}
