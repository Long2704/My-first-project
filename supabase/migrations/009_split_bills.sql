-- Chạy sau 008_menu_management.sql. Chỉ chuyển dòng món chưa trả giữa các bill cùng phiên.
begin;
create table public.bill_moves (
 request_id uuid primary key,
 session_id uuid not null references public.table_sessions(id),
 user_id uuid not null references public.profiles(id),
 payload jsonb not null,
 target_bill integer not null check(target_bill>0),
 created_at timestamptz not null default now()
);
alter table public.bill_moves enable row level security;
revoke all on public.bill_moves from public,anon,authenticated;
grant select on public.bill_moves to authenticated;
create policy bill_moves_cashier_read on public.bill_moves for select to authenticated
 using ((select public.current_staff_role()) in ('chu','thu_ngan'));

create function public.move_bill_items(p_session_id uuid,p_request_id uuid,p_from_bill integer,
 p_to_bill integer,p_item_ids uuid[],p_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_table integer; v_ids uuid[]; v_payload jsonb;
 v_existing public.bill_moves%rowtype; v_count integer; v_target integer; v_items jsonb;
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then
  raise exception 'Bạn không có quyền tách/gộp bill.';
 end if;
 if p_session_id is null or p_request_id is null or p_from_bill is null or p_from_bill not between 1 and 9999
  or p_to_bill is null or p_to_bill not between 0 and 9999 or p_to_bill=p_from_bill then
  raise exception 'Thông tin bill không hợp lệ.';
 end if;
 if p_item_ids is null or cardinality(p_item_ids) not between 1 and 500 then raise exception 'Chọn từ 1 đến 500 dòng món.'; end if;
 select array_agg(x order by x),count(distinct x) into v_ids,v_count from unnest(p_item_ids) x;
 if v_count<>cardinality(p_item_ids) then raise exception 'Danh sách dòng món bị trùng hoặc không hợp lệ.'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'Lý do tách/gộp phải từ 1 đến 500 ký tự.'; end if;
 v_payload:=jsonb_build_object('session_id',p_session_id,'from_bill',p_from_bill,'to_bill',p_to_bill,'item_ids',v_ids,'reason',btrim(p_reason));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.bill_moves where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.payload is distinct from v_payload then raise exception 'Mã tách/gộp bill đã được sử dụng.'; end if;
  return v_existing.target_bill;
 end if;
 select table_id into v_table from public.table_sessions where id=p_session_id;
 if not found then raise exception 'Phiên bàn không tồn tại hoặc đã đóng.'; end if;
 perform 1 from public.restaurant_tables where id=v_table for update;
 perform 1 from public.table_sessions where id=p_session_id and closed_at is null for update;
 if not found then raise exception 'Phiên bàn không tồn tại hoặc đã đóng.'; end if;
 if not exists(select 1 from public.table_sessions where id=p_session_id and table_id=v_table) then
  raise exception 'Bàn vừa được chuyển. Đồng bộ và kiểm tra lại.';
 end if;
 perform 1 from public.order_items i join public.orders o on o.id=i.order_id
  where o.session_id=p_session_id and i.id=any(v_ids) for update of i;
 select count(*) into v_count from public.order_items i join public.orders o on o.id=i.order_id
  where o.session_id=p_session_id and i.id=any(v_ids) and i.bill_no=p_from_bill and not i.paid and i.cancelled_at is null;
 if v_count<>cardinality(v_ids) then raise exception 'Món hoặc bill đã thay đổi. Đồng bộ và chọn lại.'; end if;
 if p_to_bill=0 then
  select coalesce(max(i.bill_no),0)+1 into v_target from public.order_items i join public.orders o on o.id=i.order_id where o.session_id=p_session_id;
  if v_target>9999 then raise exception 'Không thể tạo thêm bill trong phiên này.'; end if;
 else
  v_target:=p_to_bill;
  if not exists(select 1 from public.order_items i join public.orders o on o.id=i.order_id
   where o.session_id=p_session_id and i.bill_no=v_target and not i.paid and i.cancelled_at is null) then
   raise exception 'Bill đích không còn món chưa thanh toán. Chọn lại bill đích.';
  end if;
 end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'qty',qty,'price',price) order by id) into v_items from public.order_items where id=any(v_ids);
 update public.order_items set bill_no=v_target where id=any(v_ids);
 insert into public.bill_moves(request_id,session_id,user_id,payload,target_bill) values(p_request_id,p_session_id,v_user,v_payload,v_target);
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('bill_move',v_table,p_session_id,v_user,jsonb_build_object('from_bill',p_from_bill,'to_bill',v_target,'items',v_items,'reason',btrim(p_reason)));
 return v_target;
end;
$$;
revoke all on function public.move_bill_items(uuid,uuid,integer,integer,uuid[],text) from public,anon;
grant execute on function public.move_bill_items(uuid,uuid,integer,integer,uuid[],text) to authenticated;

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
  v_bill_no integer;
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

  -- Gọi thêm vào bill chưa trả có số nhỏ nhất; không đưa vào bill đã trả.
  select coalesce(min(i.bill_no),1) into v_bill_no from public.order_items i join public.orders o on o.id=i.order_id
    where o.session_id=v_session and not i.paid and i.cancelled_at is null;

  insert into public.orders(session_id, request_id, status, kitchen_relevant, created_by, submitted_table_id)
    values (v_session, p_request_id, 'cooking', true, v_user, p_table_id)
    returning id into v_order;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(menu_item_id uuid, qty integer, note text, expected_price integer)
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
    if v_item.expected_price is not null and v_item.expected_price<>v_menu.price then
      raise exception 'Giá món đã thay đổi. Kiểm tra thực đơn trước khi gửi lại.';
    end if;

    insert into public.order_items(order_id, menu_item_id, name, price, qty, category, note, bill_no)
      values (v_order, v_menu.id, v_menu.name, v_menu.price,
        v_item.qty, v_menu.category, coalesce(v_item.note, ''), v_bill_no);
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



-- Cùng thứ tự khóa với thanh toán/tách bill, kể cả đơn bếp của phiên đã trả.
create or replace function public.complete_kitchen_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_table integer; v_session uuid;
begin
 if auth.uid() is null or coalesce(public.current_staff_role(),'') not in ('bep','thu_ngan','chu') then
  raise exception 'Bạn không có quyền hoàn thành đơn bếp.';
 end if;
 select s.table_id,s.id into v_table,v_session from public.orders o join public.table_sessions s on s.id=o.session_id where o.id=p_order_id;
 if not found then raise exception 'Không tìm thấy đơn.'; end if;
 perform 1 from public.restaurant_tables where id=v_table for update;
 perform 1 from public.table_sessions where id=v_session for update;
 if not exists(select 1 from public.table_sessions where id=v_session and table_id=v_table) then
  raise exception 'Bàn vừa được chuyển. Đồng bộ và thử lại.';
 end if;
 perform 1 from public.orders where id=p_order_id for update;
 update public.orders set status='done',done_at=now() where id=p_order_id and status='cooking';
end;
$$;
commit;
