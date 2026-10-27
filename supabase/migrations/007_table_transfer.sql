-- Chạy sau 006_revenue_report.sql. Giữ nguyên phiên khách và đơn khi chuyển bàn.
begin;
-- Giữ bàn gốc của yêu cầu gửi đơn để thử lại sau chuyển bàn không bị tạo trùng.
alter table public.orders add column submitted_table_id integer references public.restaurant_tables(id);
update public.orders o set submitted_table_id=s.table_id from public.table_sessions s where s.id=o.session_id;
alter table public.orders alter column submitted_table_id set not null;
create table public.table_transfers (
 request_id uuid primary key,
 session_id uuid not null references public.table_sessions(id),
 from_table integer not null references public.restaurant_tables(id),
 to_table integer not null references public.restaurant_tables(id),
 user_id uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 500),
 created_at timestamptz not null default now(),
 check(from_table<>to_table)
);
alter table public.table_transfers enable row level security;
revoke all on public.table_transfers from anon,authenticated;
grant select on public.table_transfers to authenticated;
create policy transfers_cashier_read on public.table_transfers for select to authenticated
 using ((select public.current_staff_role()) in ('chu','thu_ngan'));

create function public.transfer_table(p_session_id uuid,p_from_table integer,p_to_table integer,p_request_id uuid,p_reason text)
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
   or v_existing.reason is distinct from btrim(p_reason) then
   raise exception 'Mã chuyển bàn đã được sử dụng.';
  end if;
  return v_existing.session_id;
 end if;
 if p_session_id is null or p_from_table is null or p_to_table is null or p_from_table=p_to_table then
  raise exception 'Bàn chuyển không hợp lệ.';
 end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
  raise exception 'Lý do chuyển phải từ 1 đến 500 ký tự.';
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
 update public.table_sessions set table_id=p_to_table where id=p_session_id;
 insert into public.table_transfers(request_id,session_id,from_table,to_table,user_id,reason)
 values(p_request_id,p_session_id,p_from_table,p_to_table,v_user,btrim(p_reason));
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('table_transfer',p_to_table,p_session_id,v_user,jsonb_build_object('from_table',p_from_table,'to_table',p_to_table,'reason',btrim(p_reason),'request_id',p_request_id));
 return p_session_id;
end;
$$;
revoke all on function public.transfer_table(uuid,integer,integer,uuid,text) from public,anon;
grant execute on function public.transfer_table(uuid,integer,integer,uuid,text) to authenticated;

create or replace function public.submit_order(
  p_table_id integer,
  p_request_id uuid,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid;
  v_order uuid;
  v_existing public.orders%rowtype;
  v_item record;
  v_menu public.menu_items%rowtype;
  v_kitchen boolean := false;
begin
  if v_user is null or coalesce(public.current_staff_role(), '')
      not in ('phuc_vu', 'thu_ngan', 'chu') then
    raise exception 'Bạn không có quyền gửi đơn.';
  end if;
  if p_request_id is null then
    raise exception 'Thiếu mã yêu cầu.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Danh sách món không hợp lệ.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Đơn phải có từ 1 đến 100 dòng món.';
  end if;

  -- Cùng mã yêu cầu chỉ tạo một đơn, kể cả hai thiết bị gửi đồng thời.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );
  select * into v_existing from public.orders where request_id = p_request_id;
  if found then
    if v_existing.created_by <> v_user then
      raise exception 'Mã yêu cầu đã được sử dụng.';
    end if;
    if v_existing.submitted_table_id <> p_table_id then
      raise exception 'Mã yêu cầu không thuộc bàn này.';
    end if;
    return v_existing.id;
  end if;

  -- Khóa bàn để các đơn cùng bàn dùng chung phiên khách.
  perform 1 from public.restaurant_tables
    where id = p_table_id and is_active = true for update;
  if not found then raise exception 'Bàn không hoạt động.'; end if;

  select id into v_session from public.table_sessions
    where table_id = p_table_id and closed_at is null;
  if v_session is null then
    insert into public.table_sessions(table_id)
      values (p_table_id) returning id into v_session;
  end if;

  insert into public.orders(session_id, request_id, status, kitchen_relevant, created_by, submitted_table_id)
    values (v_session, p_request_id, 'cooking', true, v_user, p_table_id)
    returning id into v_order;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(menu_item_id uuid, qty integer, note text)
  loop
    if v_item.qty is null or v_item.qty not between 1 and 99 then
      raise exception 'Số lượng phải từ 1 đến 99.';
    end if;
    if char_length(coalesce(v_item.note, '')) > 500 then
      raise exception 'Ghi chú tối đa 500 ký tự.';
    end if;
    select * into v_menu from public.menu_items
      where id = v_item.menu_item_id and is_active = true and is_out = false
      for share;
    if not found then raise exception 'Món đã ngừng bán hoặc hết món.'; end if;

    insert into public.order_items(order_id, menu_item_id, name, price, qty, category, note)
      values (v_order, v_menu.id, v_menu.name, v_menu.price,
        v_item.qty, v_menu.category, coalesce(v_item.note, ''));
    if v_menu.category <> 'do_uong' then v_kitchen := true; end if;
  end loop;

  update public.orders
    set kitchen_relevant = v_kitchen,
        status = case when v_kitchen then 'cooking' else 'done' end,
        done_at = case when v_kitchen then null else now() end
    where id = v_order;
  return v_order;
end;
$$;

create or replace function public.cancel_order_item(p_item_id uuid, p_reason text)
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
  if not exists(select 1 from public.table_sessions where id=p_session_id and table_id=v_table) then
    raise exception 'Bàn vừa được chuyển. Đồng bộ và thử lại.';
  end if;

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



commit;
