-- Chạy sau 009. Đã bao gồm thay đổi 010; không cần chạy 010 riêng.
begin;
alter table public.table_sessions add column table_path integer[] not null default '{}';
-- Khôi phục lịch sử cũ theo thời điểm được ghi; luôn kết thúc bằng bàn hiện tại.
with history as (
 select session_id,array[(array_agg(from_table order by created_at,request_id))[1]]||array_agg(to_table order by created_at,request_id) path
 from public.table_transfers group by session_id
)
update public.table_sessions s set table_path=case when h.path[cardinality(h.path)]=s.table_id then h.path else array_append(h.path,s.table_id) end
 from history h where h.session_id=s.id;
update public.table_sessions set table_path=array[table_id] where cardinality(table_path)=0;
alter table public.table_transfers drop constraint if exists table_transfers_reason_check;
alter table public.table_transfers add constraint table_transfers_reason_check check(length(btrim(reason))<=500);
create or replace function public.transfer_table(p_session_id uuid,p_from_table integer,p_to_table integer,p_request_id uuid,p_reason text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_existing public.table_transfers%rowtype; v_session public.table_sessions%rowtype;
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then
  raise exception 'Bạn không có quyền chuyển bàn.';
 end if;
 if p_request_id is null then raise exception 'Thiếu mã chuyển bàn.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.table_transfers where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.session_id is distinct from p_session_id
   or v_existing.from_table is distinct from p_from_table or v_existing.to_table is distinct from p_to_table
   or v_existing.reason is distinct from btrim(coalesce(p_reason,'')) then
   raise exception 'Mã chuyển bàn đã được sử dụng.';
  end if;
  return v_existing.session_id;
 end if;
 if p_session_id is null or p_from_table is null or p_to_table is null or p_from_table=p_to_table then
  raise exception 'Bàn chuyển không hợp lệ.';
 end if;
 if length(btrim(coalesce(p_reason,'')))>500 then
  raise exception 'Lý do chuyển tối đa 500 ký tự.';
 end if;
 -- Khóa cả hai bàn theo id tăng dần, trước phiên khách như gửi đơn/thanh toán.
 perform 1 from public.restaurant_tables where id in (p_from_table,p_to_table) order by id for update;
 if not exists(select 1 from public.restaurant_tables where id=p_to_table and is_active) then
  raise exception 'Bàn đích không hoạt động.';
 end if;
 select * into v_session from public.table_sessions where id=p_session_id for update;
 if not found or v_session.closed_at is not null then raise exception 'Phiên bàn đã đóng hoặc không tồn tại.'; end if;
 if v_session.table_id<>p_from_table then raise exception 'Phiên khách đã chuyển sang bàn khác. Đồng bộ và kiểm tra lại.'; end if;
 if exists(select 1 from public.table_sessions where table_id=p_to_table and closed_at is null) then
  raise exception 'Bàn đích đang có khách. Chọn bàn trống khác.';
 end if;
 update public.table_sessions set table_id=p_to_table,
  table_path=case when cardinality(table_path)=0 then array[p_from_table,p_to_table] else array_append(table_path,p_to_table) end
  where id=p_session_id;
 insert into public.table_transfers(request_id,session_id,from_table,to_table,user_id,reason)
 values(p_request_id,p_session_id,p_from_table,p_to_table,v_user,btrim(coalesce(p_reason,'')));
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('table_transfer',p_to_table,p_session_id,v_user,jsonb_build_object('from_table',p_from_table,'to_table',p_to_table,'reason',btrim(coalesce(p_reason,'')),'request_id',p_request_id));
 return p_session_id;
end;
$$;


alter table public.order_items drop constraint cancellation_valid;
alter table public.order_items add constraint cancellation_valid check (
 (cancelled_at is null and cancelled_by is null and cancel_reason is null) or
 (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null and length(btrim(cancel_reason))<=500 and not paid));
create or replace function public.cancel_order_item(p_item_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := auth.uid(); v_session uuid; v_table integer;
 v_item public.order_items%rowtype;
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then
  raise exception 'Bạn không có quyền hủy món.';
 end if;
 if length(btrim(coalesce(p_reason,'')))>500 then
  raise exception 'Ghi chú hủy tối đa 500 ký tự.';
 end if;
 select o.session_id,s.table_id into v_session,v_table from public.order_items i
 join public.orders o on o.id=i.order_id join public.table_sessions s on s.id=o.session_id where i.id=p_item_id;
 if not found then raise exception 'Không tìm thấy món.'; end if;
 -- Cùng thứ tự khóa với gửi đơn và thanh toán.
 perform 1 from public.restaurant_tables where id=v_table for update;
 perform 1 from public.table_sessions where id=v_session for update;
 if not exists(select 1 from public.table_sessions where id=v_session and table_id=v_table) then
  raise exception 'Bàn vừa được chuyển. Đồng bộ và thử lại.';
 end if;
 -- Khóa đơn trước dòng món, cùng thứ tự với hoàn thành bếp.
 perform 1 from public.orders o join public.order_items i on i.order_id=o.id where i.id=p_item_id for update of o;
 select * into v_item from public.order_items where id=p_item_id for update;
 if v_item.cancelled_at is not null then return; end if;
 if v_item.paid then raise exception 'Không thể hủy món đã thanh toán.'; end if;
 if exists(select 1 from public.table_sessions where id=v_session and closed_at is not null) then
  raise exception 'Phiên bàn đã đóng.';
 end if;
 update public.order_items set cancelled_at=now(),cancelled_by=v_user,cancel_reason=btrim(coalesce(p_reason,'')) where id=p_item_id;
 if not exists(select 1 from public.order_items where order_id=v_item.order_id and category<>'do_uong' and cancelled_at is null) then
  update public.orders set kitchen_relevant=false,status='done',done_at=coalesce(done_at,now()) where id=v_item.order_id;
 end if;
 if not exists(select 1 from public.order_items i join public.orders o on o.id=i.order_id
  where o.session_id=v_session and not i.paid and i.cancelled_at is null) then
  update public.table_sessions set closed_at=now() where id=v_session;
 end if;
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('cancel_item',v_table,v_session,v_user,jsonb_build_object('item_id',v_item.id,'order_id',v_item.order_id,
 'name',v_item.name,'qty',v_item.qty,'price',v_item.price,'reason',btrim(coalesce(p_reason,'')),'kitchen_status',
 (select status from public.orders where id=v_item.order_id)));
end;
$$;

create table public.table_cancellations (
 request_id uuid primary key,session_id uuid not null references public.table_sessions(id),
 user_id uuid not null references public.profiles(id),item_ids uuid[] not null,created_at timestamptz not null default now()
);
alter table public.table_cancellations enable row level security;
revoke all on public.table_cancellations from public,anon,authenticated;
grant select on public.table_cancellations to authenticated;
create policy table_cancellations_cashier_read on public.table_cancellations for select to authenticated
 using ((select public.current_staff_role()) in ('chu','thu_ngan'));
create function public.cancel_table_session(p_session_id uuid,p_request_id uuid,p_expected_item_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_table integer;v_existing public.table_cancellations%rowtype;v_expected uuid[];v_ids uuid[];v_items jsonb;
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then raise exception 'Bạn không có quyền hủy bàn.'; end if;
 if p_session_id is null or p_request_id is null or p_expected_item_ids is null or cardinality(p_expected_item_ids)=0 then raise exception 'Thiếu thông tin xác nhận hủy bàn.'; end if;
 select array_agg(x order by x) into v_expected from unnest(p_expected_item_ids) x;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.table_cancellations where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.session_id<>p_session_id or v_existing.item_ids is distinct from v_expected then raise exception 'Mã hủy bàn đã được sử dụng.'; end if;
  return;
 end if;
 select table_id into v_table from public.table_sessions where id=p_session_id;
 if not found then raise exception 'Phiên bàn không còn mở.'; end if;
 perform 1 from public.restaurant_tables where id=v_table for update;
 perform 1 from public.table_sessions where id=p_session_id and closed_at is null for update;
 if not found then raise exception 'Phiên bàn không còn mở.'; end if;
 if not exists(select 1 from public.table_sessions where id=p_session_id and table_id=v_table) then raise exception 'Bàn vừa được chuyển. Đồng bộ và kiểm tra lại.'; end if;
 perform 1 from public.orders where session_id=p_session_id order by id for update;
 perform 1 from public.order_items i join public.orders o on o.id=i.order_id
  where o.session_id=p_session_id and not i.paid and i.cancelled_at is null for update of i;
 select array_agg(i.id order by i.id),jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'qty',i.qty,'price',i.price) order by i.id) into v_ids,v_items
  from public.order_items i join public.orders o on o.id=i.order_id where o.session_id=p_session_id and not i.paid and i.cancelled_at is null;
 if v_ids is null or v_ids is distinct from v_expected then raise exception 'Danh sách món đã thay đổi. Đồng bộ và xác nhận hủy bàn lại.'; end if;
 update public.order_items set cancelled_at=now(),cancelled_by=v_user,cancel_reason='' where id=any(v_ids);
 update public.orders o set status='done',kitchen_relevant=false,done_at=coalesce(done_at,now())
  where session_id=p_session_id and not exists(select 1 from public.order_items i where i.order_id=o.id and i.category<>'do_uong' and i.cancelled_at is null);
 update public.table_sessions set closed_at=now() where id=p_session_id;
 insert into public.table_cancellations(request_id,session_id,user_id,item_ids) values(p_request_id,p_session_id,v_user,v_ids);
 insert into public.audit_log(type,table_no,session_id,user_id,extra) values('cancel_table',v_table,p_session_id,v_user,jsonb_build_object('items',v_items,'count',cardinality(v_ids)));
end;
$$;
revoke all on function public.cancel_table_session(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.cancel_table_session(uuid,uuid,uuid[]) to authenticated;
commit;
