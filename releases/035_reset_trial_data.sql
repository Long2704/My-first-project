-- ONE-OFF, DESTRUCTIVE, explicitly authorized: all orders/images at the cutoff are TEST data.
-- Not a migration. Never run once real sales have begun. Close all POS clients first.
-- Export 035_trial_data_backup.sql and download wanted test images before emptying Storage.
-- Empty ONLY kitchen-ticket-images via the Storage Dashboard/API; do NOT DELETE storage.objects in SQL.
-- This script aborts on newer transactions, nonempty image bucket, repeat reset or FK conflicts.
begin;
set local lock_timeout='10s';
lock table public.pos_runtime_settings,public.bill_items,public.bill_orders,public.order_items,
 public.bills,public.orders,public.table_sessions,public.table_transfers,public.bill_moves,
 public.table_cancellations,public.takeaway_requests,public.audit_log,
 public.kitchen_image_tickets,public.kitchen_image_uploads in access exclusive mode;
do $reset$
declare cutoff constant timestamptz:='2026-11-01 16:17:28+00'; v_seq text;
begin
 if not exists(select 1 from public.pos_runtime_settings where id and not trial_reset_done) then raise exception 'Dữ liệu thử đã được đặt lại; không chạy lần nữa.'; end if;
 if exists(select 1 from public.orders where created_at>cutoff)
 or exists(select 1 from public.bills where paid_at>cutoff)
 or exists(select 1 from public.table_sessions where opened_at>cutoff)
 or exists(select 1 from public.table_transfers where created_at>cutoff)
 or exists(select 1 from public.bill_moves where created_at>cutoff)
 or exists(select 1 from public.table_cancellations where created_at>cutoff)
 or exists(select 1 from public.takeaway_requests where created_at>cutoff)
 or exists(select 1 from public.kitchen_image_tickets where created_at>cutoff)
 or exists(select 1 from public.kitchen_image_uploads where created_at>cutoff)
 then raise exception 'Có dữ liệu mới sau mốc xác nhận dữ liệu thử. Dừng để kiểm tra; không tự đổi mốc.'; end if;
 if not exists(select 1 from storage.buckets where id='kitchen-ticket-images' and not public) then raise exception 'Giữ bucket kitchen-ticket-images ở Private; không xóa bucket.'; end if;
 if exists(select 1 from storage.objects where bucket_id='kitchen-ticket-images') then raise exception 'Bucket ảnh chưa trống. Xóa file bằng Storage Dashboard/API trước, không xóa storage.objects bằng SQL.'; end if;
 -- Preserve account/configuration audit entries that are not linked to sales.
 delete from public.audit_log where session_id is not null or bill_id is not null;
 delete from public.bill_items;
 delete from public.bill_orders;
 delete from public.table_transfers;
 delete from public.bill_moves;
 delete from public.table_cancellations;
 delete from public.takeaway_requests;
 update public.order_items set bill_id=null where bill_id is not null;
 delete from public.order_items;
 delete from public.bills;
 delete from public.orders;
 delete from public.table_sessions;
 delete from public.kitchen_image_tickets;
 delete from public.kitchen_image_uploads;
 v_seq:=pg_get_serial_sequence('public.bills','invoice_no');
 if v_seq is not null then execute format('alter sequence %s restart with 1',v_seq::regclass); end if;
 -- Keep all accounts, staff-management records, menu, prices, table settings and permissions.
 update public.pos_runtime_settings set data_epoch=data_epoch+1,image_epoch=image_epoch+1,trial_reset_done=true where id;
end $reset$;
commit;
select 'Reset completed' as result,
 (select count(*) from public.orders) as orders,
 (select count(*) from public.bills) as bills,
 (select count(*) from public.table_sessions) as sessions,
 (select count(*) from public.kitchen_image_tickets) as image_tickets;
