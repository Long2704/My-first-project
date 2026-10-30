begin;

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

commit;
