begin;

-- An arrival can be recorded without asserting the total stock or inventing a conversion.
alter table inventory_stock_receipts alter column count_quantity drop not null;
alter table inventory_stock_receipts alter column conversion_snapshot drop not null;
alter table inventory_stock_receipts drop constraint if exists inventory_stock_receipts_mode_check;
alter table inventory_stock_receipts add constraint inventory_stock_receipts_mode_check check (mode in ('add', 'included', 'unverified'));
alter table inventory_stock_receipts drop constraint if exists inventory_stock_receipts_balance_mode_check;
alter table inventory_stock_receipts add constraint inventory_stock_receipts_balance_mode_check check (
  (mode = 'unverified' and count_quantity is null and conversion_snapshot is null)
  or (mode in ('add', 'included') and count_quantity is not null and count_quantity > 0 and conversion_snapshot is not null)
);

commit;
