-- Phát hành production từ schema 016 đã xác nhận bằng production_preflight.
-- Chạy NGUYÊN FILE một lần trong SQL Editor của project bản thật.
-- Toàn bộ thay đổi nằm trong một transaction; lỗi thì không áp dụng dở dang.
begin;
set local lock_timeout = '10s';

do $preflight$
begin
 if (select array_agg(column_name::text order by ordinal_position)
     from information_schema.columns where table_schema='public' and table_name='profiles')
    is distinct from array['id','name','role','created_at']::text[] then
  raise exception 'Schema profiles khác bản đã kiểm tra. Dừng, không chạy lại hoặc bỏ kiểm tra.';
 end if;
 if to_regprocedure('public.has_permission(text)') is not null
    or to_regprocedure('public.get_my_access()') is not null
    or to_regclass('public.owner_access_guard') is not null then
  raise exception 'Có cập nhật phân quyền đã tồn tại. Cần chọn migration còn thiếu.';
 end if;
 if not exists(select 1 from public.profiles where role='chu') then
  raise exception 'Không tìm thấy Owner. Dừng để kiểm tra tài khoản.';
 end if;
 if exists(select 1 from public.profiles where role='thu_ngan') then
  raise exception 'Có tài khoản Thu ngân cũ. Cần xác định quyền trước khi chuyển đổi.';
 end if;
 if exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal) then
  raise exception 'Auth đã có trigger khác. Cần đối chiếu trước khi áp dụng.';
 end if;
end;
$preflight$;

-- === 017_staff_access.sql ===

alter table public.profiles
  add column staff_code text,
  add column is_active boolean not null default true;

alter table public.profiles
  add constraint profiles_staff_code_not_blank
  check (staff_code is null or length(btrim(staff_code)) > 0);

create unique index profiles_staff_code_unique
  on public.profiles (lower(btrim(staff_code)))
  where staff_code is not null;

create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = ''
as $function$
  select role from public.profiles
  where id = (select auth.uid()) and is_active = true;
$function$;


-- === 018_protect_last_owner.sql ===

create table public.owner_access_guard (
  id boolean primary key default true check (id = true),
  revision bigint not null default 0
);
insert into public.owner_access_guard (id) values (true);
alter table public.owner_access_guard enable row level security;
revoke all on public.owner_access_guard from public, anon, authenticated;

create function public.protect_last_active_owner()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if old.role <> 'chu' or not old.is_active then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.role = 'chu' and new.is_active then return new; end if;
  end if;
  update public.owner_access_guard set revision = revision + 1 where id = true;
  if not found then raise exception 'Thiếu dữ liệu bảo vệ Owner.'; end if;
  if not exists (
    select 1 from public.profiles
    where role = 'chu' and is_active = true and id <> old.id
  ) then
    raise exception 'Không thể khóa, hạ quyền hoặc xóa Owner hoạt động cuối cùng.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.protect_last_active_owner() from public, anon, authenticated;
create trigger protect_last_active_owner
before update or delete on public.profiles
for each row execute function public.protect_last_active_owner();


-- === 019_restrict_direct_writes.sql ===
-- Chỉ thu hẹp quyền ghi trên các bảng của POS, không tác động bảng khác.
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

-- === 020_order_roles.sql ===

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
      not in ('phuc_vu', 'bep', 'chu') then
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


-- === 021_central_permissions.sql ===
-- Chỉ áp dụng sau 017–020. Không thay đổi dữ liệu hoặc cấp quyền thanh toán RPC.

-- Danh sách quyền được quản lý bằng migration, không bằng metadata từ frontend.
create function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with role_permissions(role, permissions) as (
    values
      ('chu', array[
        'orders.read', 'orders.create', 'orders.cancel',
        'payments.collect', 'payments.discount',
        'kitchen.complete', 'tables.transfer', 'bills.split',
        'menu.manage', 'tables.manage', 'reports.read', 'audit.read',
        'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]),
      ('phuc_vu', array[
        'orders.read', 'orders.create', 'payments.collect',
        'tables.transfer', 'bills.split', 'receipts.read_own'
      ]::text[]),
      ('bep', array[
        'orders.read', 'orders.create', 'payments.collect',
        'tables.transfer', 'bills.split', 'receipts.read_own',
        'kitchen.complete'
      ]::text[])
  )
  select exists (
    select 1
    from public.profiles p
    join role_permissions r on r.role = p.role
    where p.id = (select auth.uid())
      and p.is_active = true
      and p_permission = any(r.permissions)
  );
$function$;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

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
  if v_user is null or not public.has_permission('orders.create') then
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


-- === 022_payment_permissions.sql ===
-- Sau 021: thanh toán theo quyền tập trung, giảm giá chỉ Owner.

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
  if v_user is null or not public.has_permission('payments.collect') then
    raise exception 'Bạn không có quyền thanh toán.';
  end if;
  if p_discount_value > 0
     and not public.has_permission('payments.discount') then
    raise exception 'Chỉ Owner được giảm giá.';
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


-- === 023_kitchen_service_access.sql ===
-- Chạy sau 022, trên project thử nghiệm trước. Không thay dữ liệu lịch sử.

create function public.get_my_access()
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select jsonb_build_object(
    'name', p.name, 'role', p.role, 'is_active', p.is_active,
    'permissions', (
      select coalesce(jsonb_agg(permission), '[]'::jsonb)
      from unnest(array[
        'orders.read', 'orders.create', 'orders.cancel',
        'payments.collect', 'payments.discount', 'kitchen.complete',
        'tables.transfer', 'bills.split', 'menu.manage', 'tables.manage',
        'reports.read', 'audit.read', 'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]) as permission
      where public.has_permission(permission)
    )
  )
  from public.profiles p where p.id = (select auth.uid());
$function$;
revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated;

alter policy items_staff_read on public.order_items
using ((select public.has_permission('orders.read')));

alter policy bills_staff_read on public.bills
using (
  (select public.has_permission('receipts.read_all'))
  or (
    (select public.has_permission('receipts.read_own'))
    and cashier_id = (select auth.uid())
  )
);
alter policy bill_items_staff_read on public.bill_items
using (exists (select 1 from public.bills b where b.id = bill_items.bill_id));
alter policy bill_orders_staff_read on public.bill_orders
using (exists (select 1 from public.bills b where b.id = bill_orders.bill_id));
alter policy audit_cashier_read on public.audit_log
using ((select public.has_permission('audit.read')));

-- Đóng nhánh truy cập theo user_id ngay cả khi JWT cũ còn hiệu lực.
alter policy takeaway_requests_read on public.takeaway_requests
using (
  (select public.has_permission('receipts.read_all'))
  or ((select public.has_permission('orders.read')) and user_id = (select auth.uid()))
);

create or replace function public.transfer_dine_in_internal(p_session_id uuid,p_from_table integer,p_to_table integer,p_request_id uuid,p_reason text default '',p_expected_target_session uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_existing public.table_transfers%rowtype; v_session public.table_sessions%rowtype; v_target uuid; v_offset integer; v_count integer;
begin
 if v_user is null or not public.has_permission('tables.transfer') then
  raise exception 'Bạn không có quyền chuyển bàn.';
 end if;
 if p_request_id is null then raise exception 'Thiếu mã chuyển bàn.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.table_transfers where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.session_id is distinct from p_session_id
   or v_existing.from_table is distinct from p_from_table or v_existing.to_table is distinct from p_to_table
   or v_existing.reason is distinct from btrim(coalesce(p_reason,''))
   or v_existing.target_session_id is distinct from p_expected_target_session then
   raise exception 'Mã chuyển bàn đã được sử dụng.';
  end if;
  return coalesce(v_existing.target_session_id,v_existing.session_id);
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
 -- Hai bàn đã khóa: mọi RPC gửi/thanh toán/chuyển đều đi qua khóa bàn.
 perform 1 from public.table_sessions where id=p_session_id or (table_id=p_to_table and closed_at is null) order by id for update;
 select * into v_session from public.table_sessions where id=p_session_id;
 if not found or v_session.closed_at is not null then raise exception 'Phiên bàn đã đóng hoặc không tồn tại.'; end if;
 if v_session.table_id<>p_from_table then raise exception 'Phiên khách đã chuyển sang bàn khác. Đồng bộ và kiểm tra lại.'; end if;
 select id into v_target from public.table_sessions where table_id=p_to_table and closed_at is null;
 if v_target is distinct from p_expected_target_session then
  raise exception 'Bàn đích đã thay đổi. Đồng bộ và chọn lại bàn đích.';
 end if;
 -- Giữ đường đi riêng của từng đơn, kể cả sau khi hai phiên hợp nhất.
 perform 1 from public.orders where session_id in (p_session_id,v_target) order by id for update;
 update public.orders o set table_path=array_append(case when cardinality(o.table_path)>0 then o.table_path
   when cardinality(v_session.table_path)>0 then v_session.table_path else array[p_from_table] end,p_to_table)
  where o.session_id=p_session_id;
 if v_target is null then
  update public.table_sessions set table_id=p_to_table,
   table_path=case when cardinality(table_path)=0 then array[p_from_table,p_to_table] else array_append(table_path,p_to_table) end
   where id=p_session_id;
 else
  perform 1 from public.order_items i join public.orders o on o.id=i.order_id
   where o.session_id in (p_session_id,v_target) order by i.id for update of i;
  -- Mỗi bill chưa trả của bàn nguồn nhận một số mới ở bàn đích.
  select coalesce(max(i.bill_no),0) into v_offset from public.order_items i join public.orders o on o.id=i.order_id where o.session_id=v_target;
  select count(distinct i.bill_no) into v_count from public.order_items i join public.orders o on o.id=i.order_id
   where o.session_id=p_session_id and not i.paid and i.cancelled_at is null;
  if v_offset+v_count>9999 then raise exception 'Bàn đích không thể nhận thêm bill. Chọn bàn khác.'; end if;
  with mapping as (
   select bill_no,v_offset+row_number() over(order by bill_no) as target from (
    select distinct i.bill_no from public.order_items i join public.orders o on o.id=i.order_id
     where o.session_id=p_session_id and not i.paid and i.cancelled_at is null) bills
  )
  update public.order_items i set bill_no=m.target from mapping m,public.orders o
   where i.order_id=o.id and o.session_id=p_session_id and i.bill_no=m.bill_no and not i.paid and i.cancelled_at is null;
  update public.table_sessions set closed_at=now(),table_path=array_append(case when cardinality(table_path)>0 then table_path else array[p_from_table] end,p_to_table) where id=p_session_id;
  update public.orders set session_id=v_target where session_id=p_session_id;
 end if;
 insert into public.table_transfers(request_id,session_id,from_table,to_table,user_id,reason,target_session_id)
 values(p_request_id,p_session_id,p_from_table,p_to_table,v_user,btrim(coalesce(p_reason,'')),v_target);
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('table_transfer',p_to_table,p_session_id,v_user,jsonb_build_object('from_table',p_from_table,'to_table',p_to_table,'reason',btrim(coalesce(p_reason,'')),'request_id',p_request_id,'target_session_id',v_target,'merged',v_target is not null));
 return coalesce(v_target,p_session_id);
end;
$$;

create or replace function public.transfer_table(p_session_id uuid,p_from_table integer,p_to_table integer,p_request_id uuid,p_reason text default '',p_expected_target_session uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_permission('tables.transfer') then raise exception 'Bạn không có quyền chuyển bàn.';end if;
 if exists(select 1 from public.restaurant_tables where id in (p_from_table,p_to_table) and service_type='takeaway') then raise exception 'Đơn mang về không dùng chuyển bàn.';end if;
 return public.transfer_dine_in_internal(p_session_id,p_from_table,p_to_table,p_request_id,p_reason,p_expected_target_session);
end;
$$;

create or replace function public.move_bill_items(p_session_id uuid,p_request_id uuid,p_from_bill integer,
 p_to_bill integer,p_item_ids uuid[],p_reason text default '')
returns integer language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_table integer; v_ids uuid[]; v_payload jsonb;
 v_existing public.bill_moves%rowtype; v_count integer; v_target integer; v_items jsonb;
begin
 if v_user is null or not public.has_permission('bills.split') then
  raise exception 'Bạn không có quyền tách/gộp bill.';
 end if;
 if p_session_id is null or p_request_id is null or p_from_bill is null or p_from_bill not between 1 and 9999
  or p_to_bill is null or p_to_bill not between 0 and 9999 or p_to_bill=p_from_bill then
  raise exception 'Thông tin bill không hợp lệ.';
 end if;
 if p_item_ids is null or cardinality(p_item_ids) not between 1 and 500 then raise exception 'Chọn từ 1 đến 500 dòng món.'; end if;
 select array_agg(x order by x),count(distinct x) into v_ids,v_count from unnest(p_item_ids) x;
 if v_count<>cardinality(p_item_ids) then raise exception 'Danh sách dòng món bị trùng hoặc không hợp lệ.'; end if;
 if length(btrim(coalesce(p_reason,'')))>500 then raise exception 'Ghi chú tách/gộp tối đa 500 ký tự.'; end if;
 v_payload:=jsonb_build_object('session_id',p_session_id,'from_bill',p_from_bill,'to_bill',p_to_bill,'item_ids',v_ids,'reason',btrim(coalesce(p_reason,'')));
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
 values('bill_move',v_table,p_session_id,v_user,jsonb_build_object('from_bill',p_from_bill,'to_bill',v_target,'items',v_items,'reason',btrim(coalesce(p_reason,''))));
 return v_target;
end;
$$;

create or replace function public.complete_kitchen_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_table integer; v_session uuid;
begin
 if auth.uid() is null or not public.has_permission('kitchen.complete') then
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
 if not exists(select 1 from public.orders where id=p_order_id and session_id=v_session) then
  raise exception 'Bàn vừa được gộp. Đồng bộ và thử lại.';
 end if;
 update public.orders set status='done',done_at=now() where id=p_order_id and status='cooking';
end;
$$;

-- Giữ hàm chuyển bàn nội bộ chỉ dành cho wrapper đáng tin cậy.
revoke all on function public.transfer_dine_in_internal(uuid,integer,integer,uuid,text,uuid)
from public, anon, authenticated;

-- === 024_management_reports_audit.sql ===
-- Sau 023. Chỉ chạy trên project thử nghiệm trước.

create or replace function public.revenue_report(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_start timestamptz; v_end timestamptz; v_result jsonb;
begin
 if auth.uid() is null or not public.has_permission('reports.read') then
  raise exception 'Bạn không có quyền xem báo cáo doanh thu.';
 end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then
  raise exception 'Chọn khoảng ngày hợp lệ, tối đa 366 ngày.';
 end if;
 v_start := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
 v_end := (p_to+1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
 -- Một câu truy vấn dùng cùng snapshot cho tổng, từng ngày và món bán.
 with selected as materialized (
  select id,paid_at,gross,discount,total,method from public.bills
  where paid_at>=v_start and paid_at<v_end
 ), daily as (
  select (paid_at at time zone 'Asia/Ho_Chi_Minh')::date as "day",
   count(*) invoices,sum(gross) gross,sum(discount) discount,sum(total) total,
   coalesce(sum(total) filter(where method='cash'),0) cash,
   coalesce(sum(total) filter(where method='transfer'),0) transfer
  from selected group by 1
 ), products as (
  select i.name,sum(i.qty) qty,sum(i.qty::bigint*i.price) gross
  from public.bill_items i join selected b on b.id=i.bill_id
  group by i.name
 )
 select jsonb_build_object(
  'from',p_from,'to',p_to,'generated_at',statement_timestamp(),'products_complete',true,
  'invoices',count(*),'gross',coalesce(sum(gross),0),'discount',coalesce(sum(discount),0),
  'total',coalesce(sum(total),0),
  'cash',coalesce(sum(total) filter(where method='cash'),0),
  'transfer',coalesce(sum(total) filter(where method='transfer'),0),
  'days',coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc) from daily d),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from products p),'[]'::jsonb)
 ) into v_result from selected;
 return v_result;
end;
$$;

-- Chỉ bỏ các sự kiện được yêu cầu; không xóa bất kỳ dòng lịch sử nào.
create function public.filter_optional_audit_events()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  if new.type in (
    'table_order', 'table_update', 'takeaway_created',
    'takeaway_discarded', 'menu_update'
  ) then
    return null;
  end if;
  return new;
end;
$function$;
revoke all on function public.filter_optional_audit_events()
from public, anon, authenticated;

create trigger audit_log_filter_optional_events
before insert on public.audit_log
for each row execute function public.filter_optional_audit_events();


-- === 025_employee_directory.sql ===
-- Chạy sau 024 trên project thử nghiệm. Chỉ thêm hàm đọc, không sửa tài khoản.

create function public.list_employees(
  p_search text default '',
  p_role text default null,
  p_active boolean default null,
  p_page integer default 1,
  p_page_size integer default 20
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_search text := btrim(coalesce(p_search, ''));
  v_result jsonb;
begin
  if auth.uid() is null
     or public.current_staff_role() is distinct from 'chu'
     or not public.has_permission('employees.manage') then
    raise exception 'Chỉ Owner đang hoạt động được xem danh sách nhân viên.';
  end if;

  if char_length(v_search) > 100 then
    raise exception 'Tìm kiếm tối đa 100 ký tự.';
  end if;
  if p_role is not null and p_role not in ('chu', 'phuc_vu', 'bep') then
    raise exception 'Vai trò lọc không hợp lệ.';
  end if;
  if p_page is null or p_page < 1
     or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Phân trang không hợp lệ.';
  end if;

  -- Số dòng và trang dữ liệu dùng cùng snapshot. Không đọc auth.users/email.
  with filtered as materialized (
    select p.id, p.name, p.staff_code, p.role, p.is_active, p.created_at
    from public.profiles p
    where (p_role is null or p.role = p_role)
      and (p_active is null or p.is_active = p_active)
      and (
        v_search = ''
        or strpos(lower(p.name), lower(v_search)) > 0
        or strpos(lower(coalesce(p.staff_code, '')), lower(v_search)) > 0
      )
  ), page_rows as (
    select * from filtered
    order by created_at desc, id desc
    limit p_page_size
    offset ((p_page::bigint - 1) * p_page_size)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc)
      from page_rows r
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', p_page,
    'page_size', p_page_size
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.list_employees(text,text,boolean,integer,integer)
from public, anon;
grant execute on function public.list_employees(text,text,boolean,integer,integer)
to authenticated;


-- === 026_initial_password_gate.sql ===
-- Sau 025. Chỉ chạy trên project thử nghiệm trước.
-- Không đánh dấu lại tài khoản cũ: giá trị mặc định false giữ nguyên quyền cũ.

alter table public.profiles
  add column must_change_password boolean not null default false;

-- Tài khoản Owner hiện có không bị đưa nhầm vào luồng mật khẩu tạm cho nhân viên.
alter table public.profiles
  add constraint profiles_owner_password_ready
  check (role <> 'chu' or must_change_password = false);

create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = ''
as $function$
  select role from public.profiles
  where id = (select auth.uid())
    and is_active = true
    and must_change_password = false;
$function$;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with role_permissions(role, permissions) as (
    values
      ('chu', array[
        'orders.read', 'orders.create', 'orders.cancel',
        'payments.collect', 'payments.discount',
        'kitchen.complete', 'tables.transfer', 'bills.split',
        'menu.manage', 'tables.manage', 'reports.read', 'audit.read',
        'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]),
      ('phuc_vu', array[
        'orders.read', 'orders.create', 'payments.collect',
        'tables.transfer', 'bills.split', 'receipts.read_own'
      ]::text[]),
      ('bep', array[
        'orders.read', 'orders.create', 'payments.collect',
        'tables.transfer', 'bills.split', 'receipts.read_own',
        'kitchen.complete'
      ]::text[])
  )
  select exists (
    select 1
    from public.profiles p
    join role_permissions r on r.role = p.role
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.must_change_password = false
      and p_permission = any(r.permissions)
  );
$function$;

create or replace function public.get_my_access()
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select jsonb_build_object(
    'name', p.name, 'role', p.role, 'is_active', p.is_active,
    'must_change_password', p.must_change_password,
    'permissions', (
      select coalesce(jsonb_agg(permission), '[]'::jsonb)
      from unnest(array[
        'orders.read', 'orders.create', 'orders.cancel',
        'payments.collect', 'payments.discount', 'kitchen.complete',
        'tables.transfer', 'bills.split', 'menu.manage', 'tables.manage',
        'reports.read', 'audit.read', 'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]) as permission
      where public.has_permission(permission)
    )
  )
  from public.profiles p where p.id = (select auth.uid());
$function$;

-- Chỉ Auth server/DB admin được đổi cột hash; frontend không có quyền ghi cột này.
-- INSERT tài khoản mới, đổi metadata hoặc giữ nguyên hash KHÔNG mở quyền POS.
create function public.finish_initial_password_setup()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(new.encrypted_password, '') <> '' then
    update public.profiles
    set must_change_password = false
    where id = new.id
      and role in ('phuc_vu', 'bep')
      and must_change_password = true;
  end if;
  return new;
end;
$function$;
revoke all on function public.finish_initial_password_setup()
from public, anon, authenticated;

create trigger pos_finish_initial_password_setup
after update of encrypted_password on auth.users
for each row execute function public.finish_initial_password_setup();


-- === 027_employee_creation.sql ===
-- Sau 026. Không sửa tài khoản, hóa đơn hoặc đơn hàng hiện có.
create table if not exists public.employee_creation_requests (
 request_id uuid primary key,
 owner_id uuid not null references public.profiles(id),
 email text not null unique,
 staff_code text not null,
 name text not null,
 role text not null check(role in ('phuc_vu','bep')),
 user_id uuid unique,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check ((user_id is null) = (completed_at is null))
);
create unique index if not exists employee_creation_code_unique on public.employee_creation_requests(lower(staff_code));
alter table public.employee_creation_requests enable row level security;
revoke all on public.employee_creation_requests from public,anon,authenticated;

create or replace function public.prepare_employee_creation(p_request_id uuid,p_email text,p_staff_code text,p_name text,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_creation_requests%rowtype;
 e text:=lower(btrim(p_email)); c text:=upper(btrim(p_staff_code)); n text:=btrim(p_name);
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then
  raise exception 'Chỉ Owner đang hoạt động được tạo nhân viên.';
 end if;
 if p_request_id is null or e is null or char_length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or c is null or c !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' or n is null or char_length(n) not between 1 and 100
 or p_role is null or p_role not in ('phuc_vu','bep') then raise exception 'Thông tin nhân viên không hợp lệ.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,27));
 select * into r from public.employee_creation_requests where request_id=p_request_id;
 if found then
  if r.owner_id<>auth.uid() or r.email<>e or r.staff_code<>c or r.name<>n or r.role<>p_role then
   raise exception 'Mã yêu cầu đã được sử dụng cho thông tin khác.';
  end if;
 else
  if exists(select 1 from public.profiles where lower(btrim(staff_code))=lower(c)) then
   raise exception 'Mã nhân viên đã tồn tại.';
  end if;
  insert into public.employee_creation_requests(request_id,owner_id,email,staff_code,name,role)
   values(p_request_id,auth.uid(),e,c,n,p_role) returning * into r;
 end if;
 return jsonb_build_object('request_id',r.request_id,'user_id',r.user_id,'completed',r.completed_at is not null);
end;
$$;
revoke all on function public.prepare_employee_creation(uuid,text,text,text,text) from public,anon;
grant execute on function public.prepare_employee_creation(uuid,text,text,text,text) to authenticated;

create or replace function public.cancel_employee_creation(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_creation_requests%rowtype;
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Không có quyền.'; end if;
 select * into r from public.employee_creation_requests where request_id=p_request_id and owner_id=auth.uid() for update;
 if found and r.completed_at is not null then return jsonb_build_object('completed',true,'user_id',r.user_id); end if;
 delete from public.employee_creation_requests where request_id=p_request_id and owner_id=auth.uid() and completed_at is null;
 return jsonb_build_object('released',true);
end;
$$;
revoke all on function public.cancel_employee_creation(uuid) from public,anon;
grant execute on function public.cancel_employee_creation(uuid) to authenticated;

-- Auth tạo user + profile + nhật ký + đánh dấu hoàn tất trong cùng transaction.
-- Chỉ tin metadata ứng dụng do Admin API thiết lập; không đọc user_metadata.
create or replace function public.provision_created_employee()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.employee_creation_requests%rowtype; v_request text;
begin
 v_request:=new.raw_app_meta_data->>'pos_employee_request';
 if v_request is null then return new; end if;
 select * into r from public.employee_creation_requests where request_id=v_request::uuid for update;
 if not found or r.completed_at is not null or lower(new.email) is distinct from r.email then
  raise exception 'Yêu cầu tạo nhân viên không hợp lệ.';
 end if;
 -- Khóa hàng Owner ngăn việc khóa/hạ quyền đồng thời trong lúc cấp tài khoản.
 perform 1 from public.profiles where id=r.owner_id and role='chu' and is_active=true and must_change_password=false for share;
 if not found then raise exception 'Owner không còn quyền tạo nhân viên.'; end if;
 if coalesce(new.encrypted_password,'')='' then raise exception 'Thiếu mật khẩu tạm.'; end if;
 insert into public.profiles(id,name,staff_code,role,is_active,must_change_password)
 values(new.id,r.name,r.staff_code,r.role,true,true);
 insert into public.audit_log(type,user_id,extra)
 values('employee_created',r.owner_id,jsonb_build_object('employee_id',new.id,'staff_code',r.staff_code,'role',r.role,'request_id',r.request_id));
 update public.employee_creation_requests set user_id=new.id,completed_at=now() where request_id=r.request_id;
 return new;
end;
$$;
revoke all on function public.provision_created_employee() from public,anon,authenticated;
drop trigger if exists pos_provision_created_employee on auth.users;
create trigger pos_provision_created_employee after insert on auth.users for each row execute function public.provision_created_employee();

commit;
