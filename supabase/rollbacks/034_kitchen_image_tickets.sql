-- Disable feature, retain tickets/uploads/private images/history. Do not drop bucket or tables.
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


revoke all on function public.reserve_kitchen_image_upload(uuid,text),public.finalize_kitchen_image_upload(uuid),public.complete_kitchen_image_ticket(uuid) from authenticated;
revoke all on function public.verify_kitchen_image_upload(uuid,integer,integer,integer),public.claim_kitchen_image_cleanup(uuid),public.finish_kitchen_image_cleanup(uuid) from service_role;
-- Existing storage guards remain. has_permission now returns false for all image rights.
commit;
