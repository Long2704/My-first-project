-- Chạy sau 004_payments.sql. Giữ nguyên món và hóa đơn cũ.
begin;
alter table public.order_items add column cancelled_at timestamptz,
 add column cancelled_by uuid references public.profiles(id),
 add column cancel_reason text;
alter table public.order_items add constraint cancellation_valid check (
 (cancelled_at is null and cancelled_by is null and cancel_reason is null) or
 (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null and length(btrim(cancel_reason)) between 1 and 500 and not paid));

create function public.cancel_order_item(p_item_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := auth.uid(); v_session uuid; v_table integer;
 v_item public.order_items%rowtype;
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then
  raise exception 'Bạn không có quyền hủy món.';
 end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
  raise exception 'Lý do hủy phải từ 1 đến 500 ký tự.';
 end if;
 select o.session_id,s.table_id into v_session,v_table from public.order_items i
 join public.orders o on o.id=i.order_id join public.table_sessions s on s.id=o.session_id where i.id=p_item_id;
 if not found then raise exception 'Không tìm thấy món.'; end if;
 -- Cùng thứ tự khóa với gửi đơn và thanh toán.
 perform 1 from public.restaurant_tables where id=v_table for update;
 perform 1 from public.table_sessions where id=v_session for update;
 -- Khóa đơn trước dòng món, cùng thứ tự với hoàn thành bếp.
 perform 1 from public.orders o join public.order_items i on i.order_id=o.id where i.id=p_item_id for update of o;
 select * into v_item from public.order_items where id=p_item_id for update;
 if v_item.cancelled_at is not null then return; end if;
 if v_item.paid then raise exception 'Không thể hủy món đã thanh toán.'; end if;
 if exists(select 1 from public.table_sessions where id=v_session and closed_at is not null) then
  raise exception 'Phiên bàn đã đóng.';
 end if;
 update public.order_items set cancelled_at=now(),cancelled_by=v_user,cancel_reason=btrim(p_reason) where id=p_item_id;
 if not exists(select 1 from public.order_items where order_id=v_item.order_id and category<>'do_uong' and cancelled_at is null) then
  update public.orders set kitchen_relevant=false,status='done',done_at=coalesce(done_at,now()) where id=v_item.order_id;
 end if;
 if not exists(select 1 from public.order_items i join public.orders o on o.id=i.order_id
  where o.session_id=v_session and not i.paid and i.cancelled_at is null) then
  update public.table_sessions set closed_at=now() where id=v_session;
 end if;
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('cancel_item',v_table,v_session,v_user,jsonb_build_object('item_id',v_item.id,'order_id',v_item.order_id,
 'name',v_item.name,'qty',v_item.qty,'price',v_item.price,'reason',btrim(p_reason),'kitchen_status',
 (select status from public.orders where id=v_item.order_id)));
end;
$$;
revoke all on function public.cancel_order_item(uuid,text) from public,anon;
grant execute on function public.cancel_order_item(uuid,text) to authenticated;

create or replace function public.pay_bill(
  p_session_id uuid,
  p_request_id uuid,
  p_method text,
  p_expected_item_ids uuid[],
  p_bill_no integer default 1,
  p_discount_type text default 'amount',
  p_discount_value bigint default 0,
  p_cash_received bigint default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_table integer;
  v_bill uuid;
  v_existing public.bills%rowtype;
  v_ids uuid[];
  v_expected uuid[];
  v_gross bigint;
  v_discount bigint;
  v_total bigint;
  v_cash bigint;
begin
  if v_user is null or coalesce(public.current_staff_role(), '') not in ('thu_ngan', 'chu') then
    raise exception 'Bạn không có quyền thanh toán.';
  end if;
  if p_request_id is null then raise exception 'Thiếu mã thanh toán.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select * into v_existing from public.bills where request_id = p_request_id;
  if found then
    if v_existing.cashier_id <> v_user or v_existing.session_id <> p_session_id
       or v_existing.bill_no <> p_bill_no then
      raise exception 'Mã thanh toán đã được sử dụng.';
    end if;
    return v_existing.id;
  end if;
  if p_method is null or p_method not in ('cash', 'transfer') then
    raise exception 'Hình thức thanh toán không hợp lệ.';
  end if;
  if p_bill_no is null or p_bill_no < 1 then raise exception 'Bill không hợp lệ.'; end if;
  if p_discount_type is null or p_discount_type not in ('amount', 'percent')
      or p_discount_value is null or p_discount_value < 0 then
    raise exception 'Giảm giá không hợp lệ.';
  end if;

  select table_id into v_table from public.table_sessions where id = p_session_id;
  if not found then raise exception 'Không tìm thấy phiên bàn.'; end if;
  -- Cùng thứ tự khóa với submit_order: bàn trước, phiên sau.
  perform 1 from public.restaurant_tables where id = v_table for update;
  perform 1 from public.table_sessions where id = p_session_id and closed_at is null for update;
  if not found then raise exception 'Phiên bàn đã thanh toán xong.'; end if;

  perform 1 from public.order_items i join public.orders o on o.id = i.order_id
    where o.session_id = p_session_id and i.bill_no = p_bill_no and not i.paid and i.cancelled_at is null
    for update of i;
  select array_agg(i.id order by i.id), sum(i.price::bigint * i.qty)
    into v_ids, v_gross
    from public.order_items i join public.orders o on o.id = i.order_id
    where o.session_id = p_session_id and i.bill_no = p_bill_no and not i.paid and i.cancelled_at is null;
  if v_ids is null then raise exception 'Bill không còn món chưa thanh toán.'; end if;
  select array_agg(x order by x) into v_expected from unnest(p_expected_item_ids) as x;
  if v_expected is distinct from v_ids then
    raise exception 'Danh sách món đã thay đổi. Đồng bộ và kiểm tra lại trước khi thanh toán.';
  end if;

  if p_discount_type = 'percent' then
    if p_discount_value > 100 then raise exception 'Giảm giá tối đa 100 phần trăm.'; end if;
    -- Làm tròn đến đồng gần nhất; 0,5 làm tròn lên.
    v_discount := round(v_gross::numeric * p_discount_value / 100)::bigint;
  else
    if p_discount_value > v_gross then raise exception 'Giảm giá không được vượt tạm tính.'; end if;
    v_discount := p_discount_value;
  end if;
  v_total := v_gross - v_discount;
  if p_method = 'cash' then
    v_cash := coalesce(p_cash_received, v_total);
    if v_cash < v_total then raise exception 'Tiền khách đưa chưa đủ.'; end if;
  end if;

  insert into public.bills(request_id, session_id, table_no, bill_no, gross, discount, total,
    method, cash_received, change_due, cashier_id)
  values (p_request_id, p_session_id, v_table, p_bill_no, v_gross, v_discount, v_total,
    p_method, v_cash, case when p_method = 'cash' then v_cash - v_total else 0 end, v_user)
  returning id into v_bill;

  insert into public.bill_items(bill_id, source_item_id, name, qty, price, category, note)
  select v_bill, id, name, qty, price, category, note from public.order_items where id = any(v_ids);
  insert into public.bill_orders(bill_id, order_id)
  select distinct v_bill, order_id from public.order_items where id = any(v_ids);
  update public.order_items set paid = true, bill_id = v_bill where id = any(v_ids);

  if not exists (
    select 1 from public.order_items i join public.orders o on o.id = i.order_id
    where o.session_id = p_session_id and not i.paid and i.cancelled_at is null
  ) then
    update public.table_sessions set closed_at = now() where id = p_session_id;
  end if;
  -- Không đổi trạng thái bếp: khách trả tiền trước vẫn phải làm món.
  insert into public.audit_log(type, table_no, session_id, bill_id, user_id, extra)
  values ('payment', v_table, p_session_id, v_bill, v_user,
    jsonb_build_object('method', p_method, 'gross', v_gross, 'discount', v_discount, 'total', v_total));
  return v_bill;
end;
$$;


-- Nhật ký chỉ ghi từ server; sự kiện cũ không được tạo bù.
create function public.log_order_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 select case when TG_OP='INSERT' then 'order_created' else 'kitchen_done' end,
 s.table_id,NEW.session_id,auth.uid(),jsonb_build_object('order_id',NEW.id)
 from public.table_sessions s where s.id=NEW.session_id;
 return NEW;
end;
$$;
revoke all on function public.log_order_event() from public,anon,authenticated;
create trigger order_created_audit after insert on public.orders for each row execute function public.log_order_event();
create trigger kitchen_done_audit after update on public.orders for each row
 when (OLD.status='cooking' and NEW.status='done' and NEW.kitchen_relevant)
 execute function public.log_order_event();
commit;
