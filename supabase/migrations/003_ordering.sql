-- Chạy một lần trong Supabase SQL Editor.
begin;

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id integer not null references public.restaurant_tables(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index one_open_session_per_table
  on public.table_sessions(table_id) where closed_at is null;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id),
  request_id uuid not null unique,
  status text not null check (status in ('cooking', 'done')),
  kitchen_relevant boolean not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index orders_session_idx on public.orders(session_id);
create index orders_queue_idx on public.orders(created_at, id) where status = 'cooking';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  menu_item_id uuid not null references public.menu_items(id),
  name text not null,
  price integer not null check (price >= 0),
  qty integer not null check (qty between 1 and 99),
  category text not null check (category in ('bun', 'an_them', 'do_uong')),
  note text not null default '' check (char_length(note) <= 500),
  bill_no integer not null default 1 check (bill_no > 0),
  paid boolean not null default false
);
create index order_items_order_idx on public.order_items(order_id);

alter table public.table_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.table_sessions, public.orders, public.order_items from anon, authenticated;
grant select on public.table_sessions, public.orders, public.order_items to authenticated;

create policy sessions_staff_read on public.table_sessions
for select to authenticated using (
  (select public.current_staff_role()) in ('phuc_vu', 'bep', 'thu_ngan', 'chu')
);
create policy orders_staff_read on public.orders
for select to authenticated using (
  (select public.current_staff_role()) in ('phuc_vu', 'bep', 'thu_ngan', 'chu')
);
create policy items_staff_read on public.order_items
for select to authenticated using (
  (select public.current_staff_role()) in ('phuc_vu', 'thu_ngan', 'chu')
  or ((select public.current_staff_role()) = 'bep' and category <> 'do_uong')
);

-- Chỉ ghi đơn thông qua hàm; trình duyệt không được tự đặt giá.
create function public.submit_order(
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
    if not exists (
      select 1 from public.table_sessions
      where id = v_existing.session_id and table_id = p_table_id
    ) then
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

  insert into public.orders(session_id, request_id, status, kitchen_relevant, created_by)
    values (v_session, p_request_id, 'cooking', true, v_user)
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

create function public.complete_kitchen_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce(public.current_staff_role(), '')
      not in ('bep', 'thu_ngan', 'chu') then
    raise exception 'Bạn không có quyền hoàn thành đơn bếp.';
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;
  update public.orders set status = 'done', done_at = now()
    where id = p_order_id and status = 'cooking';
end;
$$;

revoke all on function public.submit_order(integer, uuid, jsonb) from public, anon;
revoke all on function public.complete_kitchen_order(uuid) from public, anon;
grant execute on function public.submit_order(integer, uuid, jsonb) to authenticated;
grant execute on function public.complete_kitchen_order(uuid) to authenticated;

commit;

select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('table_sessions', 'orders', 'order_items')
order by table_name;
