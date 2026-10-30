-- Chỉ thu hẹp quyền ghi trên các bảng của POS, không tác động bảng khác.
begin;
revoke all privileges on table
  public.audit_log,
  public.bill_items,
  public.bill_moves,
  public.bill_orders,
  public.bills,
  public.menu_changes,
  public.menu_items,
  public.order_items,
  public.orders,
  public.profiles,
  public.restaurant_tables,
  public.table_cancellations,
  public.table_changes,
  public.table_order_changes,
  public.table_sessions,
  public.table_transfers,
  public.takeaway_requests,
  public.owner_access_guard
from anon;
revoke insert, update, delete, truncate, references, trigger
on table
  public.audit_log,
  public.bill_items,
  public.bill_moves,
  public.bill_orders,
  public.bills,
  public.menu_changes,
  public.menu_items,
  public.order_items,
  public.orders,
  public.profiles,
  public.restaurant_tables,
  public.table_cancellations,
  public.table_changes,
  public.table_order_changes,
  public.table_sessions,
  public.table_transfers,
  public.takeaway_requests,
  public.owner_access_guard
from authenticated;
commit;
