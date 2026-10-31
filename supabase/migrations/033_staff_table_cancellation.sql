-- Sau 032. Thêm riêng quyền hủy cả bàn chưa trả; không cấp quyền hủy từng món.
-- Chỉ thay hàm phân quyền/RPC; không sửa đơn hàng, hóa đơn hoặc dữ liệu tài khoản.
begin;

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
        'kitchen.complete', 'tables.transfer', 'tables.cancel', 'bills.split',
        'menu.manage', 'tables.manage', 'reports.read', 'audit.read',
        'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]),
      ('phuc_vu', array[
        'orders.read', 'orders.create', 'payments.collect',
        'tables.transfer', 'tables.cancel', 'bills.split', 'receipts.read_own'
      ]::text[]),
      ('bep', array[
        'orders.read', 'orders.create', 'payments.collect',
        'tables.transfer', 'tables.cancel', 'bills.split', 'receipts.read_own',
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
      and (select public.staff_session_current())
      and p_permission = any(r.permissions)
  );
$function$;

create or replace function public.get_my_access()
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select jsonb_build_object(
    'name', p.name, 'role', p.role, 'is_active', p.is_active and (select public.staff_session_current()),
    'session_invalid',not (select public.staff_session_current()),
    'must_change_password', p.must_change_password,
    'permissions', (
      select coalesce(jsonb_agg(permission), '[]'::jsonb)
      from unnest(array[
        'orders.read', 'orders.create', 'orders.cancel',
        'payments.collect', 'payments.discount', 'kitchen.complete',
        'tables.transfer', 'tables.cancel', 'bills.split', 'menu.manage', 'tables.manage',
        'reports.read', 'audit.read', 'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]) as permission
      where public.has_permission(permission)
    )
  )
  from public.profiles p where p.id = (select auth.uid());
$function$;

revoke all on function public.has_permission(text) from public,anon;
grant execute on function public.has_permission(text) to authenticated;
revoke all on function public.get_my_access() from public,anon;
grant execute on function public.get_my_access() to authenticated;

create or replace function public.cancel_table_session(p_session_id uuid,p_request_id uuid,p_expected_item_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_table integer;v_existing public.table_cancellations%rowtype;v_expected uuid[];v_ids uuid[];v_items jsonb;
begin
 if v_user is null or not public.has_permission('tables.cancel') then raise exception 'Bạn không có quyền hủy bàn.'; end if;
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
