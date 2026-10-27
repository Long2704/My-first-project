-- Chạy sau 007_table_transfer.sql. Không xóa món hoặc sửa giá đơn/hóa đơn cũ.
begin;
alter table public.menu_items add column version bigint not null default 1;
revoke insert,update,delete on public.menu_items from public,anon,authenticated;
create table public.menu_changes (
 request_id uuid primary key,
 item_id uuid not null references public.menu_items(id),
 user_id uuid not null references public.profiles(id),
 payload jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.menu_changes enable row level security;
revoke all on public.menu_changes from public,anon,authenticated;
grant select on public.menu_changes to authenticated;
create policy menu_changes_owner_read on public.menu_changes for select to authenticated
 using ((select public.current_staff_role())='chu');

create function public.list_menu_management() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_staff_role(),'')<>'chu' then
  raise exception 'Chỉ chủ quán được quản lý thực đơn.';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price',price,'category',category,
  'is_active',is_active,'is_out',is_out,'sort',sort,'version',version) order by sort,id) from public.menu_items),'[]'::jsonb);
end;
$$;

create function public.save_menu_item(p_request_id uuid,p_item_id uuid,p_expected_version bigint,
 p_name text,p_price integer,p_category text,p_is_active boolean,p_is_out boolean,p_sort integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_old public.menu_items%rowtype; v_exists boolean;
 v_existing public.menu_changes%rowtype; v_payload jsonb; v_after jsonb;
begin
 if v_user is null or coalesce(public.current_staff_role(),'')<>'chu' then
  raise exception 'Chỉ chủ quán được quản lý thực đơn.';
 end if;
 if p_request_id is null or p_item_id is null then raise exception 'Thiếu mã cập nhật thực đơn.'; end if;
 v_payload:=jsonb_build_object('item_id',p_item_id,'expected_version',p_expected_version,'name',btrim(p_name),
  'price',p_price,'category',p_category,'is_active',p_is_active,'is_out',p_is_out,'sort',p_sort);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.menu_changes where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.payload is distinct from v_payload then
   raise exception 'Mã cập nhật thực đơn đã được sử dụng.';
  end if;
  return v_existing.item_id;
 end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 120 then raise exception 'Tên món phải từ 1 đến 120 ký tự.'; end if;
 if p_price is null or p_price<0 or p_price>10000000 then raise exception 'Giá món phải từ 0 đến 10000000 đồng.'; end if;
 if p_category is null or p_category not in ('bun','an_them','do_uong') then raise exception 'Nhóm món không hợp lệ.'; end if;
 if p_sort is null or p_sort not between 0 and 9999 or p_is_active is null or p_is_out is null
  or p_expected_version is null or p_expected_version<0 then raise exception 'Thông tin thực đơn không hợp lệ.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('menu:'||p_item_id::text,0));
 select * into v_old from public.menu_items where id=p_item_id for update;
 v_exists:=found;
 if (v_exists and v_old.version<>p_expected_version) or (not v_exists and p_expected_version<>0) then
  raise exception 'Món đã được cập nhật ở nơi khác. Tải lại thực đơn rồi kiểm tra lại.';
 end if;
 if v_exists then
  update public.menu_items set name=btrim(p_name),price=p_price,category=p_category,is_active=p_is_active,
   is_out=p_is_out,sort=p_sort,version=version+1 where id=p_item_id;
 else
  insert into public.menu_items(id,name,price,category,is_active,is_out,sort)
  values(p_item_id,btrim(p_name),p_price,p_category,p_is_active,p_is_out,p_sort);
 end if;
 select jsonb_build_object('name',name,'price',price,'category',category,'is_active',is_active,'is_out',is_out,'sort',sort,'version',version)
 into v_after from public.menu_items where id=p_item_id;
 insert into public.menu_changes(request_id,item_id,user_id,payload) values(p_request_id,p_item_id,v_user,v_payload);
 insert into public.audit_log(type,user_id,extra) values('menu_update',v_user,jsonb_build_object('item_id',p_item_id,
  'action',case when v_exists then 'update' else 'create' end,'before',case when v_exists then
  jsonb_build_object('name',v_old.name,'price',v_old.price,'category',v_old.category,'is_active',v_old.is_active,'is_out',v_old.is_out,'sort',v_old.sort,'version',v_old.version) else null end,'after',v_after));
 return p_item_id;
end;
$$;
revoke all on function public.list_menu_management() from public,anon;
revoke all on function public.save_menu_item(uuid,uuid,bigint,text,integer,text,boolean,boolean,integer) from public,anon;
grant execute on function public.list_menu_management() to authenticated;
grant execute on function public.save_menu_item(uuid,uuid,bigint,text,integer,text,boolean,boolean,integer) to authenticated;

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


commit;
