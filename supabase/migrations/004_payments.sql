-- Chạy một lần, sau 003_ordering.sql. Không xóa đơn hiện có.
begin;

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  invoice_no bigint generated always as identity unique,
  request_id uuid not null unique,
  session_id uuid not null references public.table_sessions(id),
  table_no integer not null references public.restaurant_tables(id),
  bill_no integer not null check (bill_no > 0),
  gross bigint not null check (gross >= 0),
  discount bigint not null check (discount >= 0 and discount <= gross),
  total bigint not null check (total = gross - discount),
  method text not null check (method in ('cash', 'transfer')),
  cash_received bigint,
  change_due bigint not null default 0 check (change_due >= 0),
  cashier_id uuid not null references public.profiles(id),
  paid_at timestamptz not null default now(),
  check (
    (method = 'cash' and cash_received is not null and cash_received >= total
      and change_due = cash_received - total)
    or (method = 'transfer' and cash_received is null and change_due = 0)
  )
);
create index bills_paid_at_idx on public.bills(paid_at desc);

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id),
  source_item_id uuid not null unique references public.order_items(id),
  name text not null,
  qty integer not null check (qty > 0),
  price integer not null check (price >= 0),
  category text not null,
  note text not null
);
create index bill_items_bill_idx on public.bill_items(bill_id);

create table public.bill_orders (
  bill_id uuid not null references public.bills(id),
  order_id uuid not null references public.orders(id),
  primary key (bill_id, order_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  table_no integer,
  session_id uuid references public.table_sessions(id),
  bill_id uuid references public.bills(id),
  user_id uuid not null references public.profiles(id),
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_time_idx on public.audit_log(created_at desc);

alter table public.order_items add column bill_id uuid references public.bills(id);
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.bill_orders enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.bills, public.bill_items, public.bill_orders, public.audit_log
  from anon, authenticated;
grant select on public.bills, public.bill_items, public.bill_orders, public.audit_log
  to authenticated;

create policy bills_staff_read on public.bills for select to authenticated
using ((select public.current_staff_role()) in ('phuc_vu', 'thu_ngan', 'chu'));
create policy bill_items_staff_read on public.bill_items for select to authenticated
using ((select public.current_staff_role()) in ('phuc_vu', 'thu_ngan', 'chu'));
create policy bill_orders_staff_read on public.bill_orders for select to authenticated
using ((select public.current_staff_role()) in ('phuc_vu', 'thu_ngan', 'chu'));
create policy audit_cashier_read on public.audit_log for select to authenticated
using ((select public.current_staff_role()) in ('thu_ngan', 'chu'));

create function public.pay_bill(
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
    where o.session_id = p_session_id and i.bill_no = p_bill_no and not i.paid
    for update of i;
  select array_agg(i.id order by i.id), sum(i.price::bigint * i.qty)
    into v_ids, v_gross
    from public.order_items i join public.orders o on o.id = i.order_id
    where o.session_id = p_session_id and i.bill_no = p_bill_no and not i.paid;
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
    where o.session_id = p_session_id and not i.paid
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

revoke all on function public.pay_bill(uuid, uuid, text, uuid[], integer, text, bigint, bigint)
  from public, anon;
grant execute on function public.pay_bill(uuid, uuid, text, uuid[], integer, text, bigint, bigint)
  to authenticated;

commit;

select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('bills', 'bill_items', 'bill_orders', 'audit_log')
order by table_name;
