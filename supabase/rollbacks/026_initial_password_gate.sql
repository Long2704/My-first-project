-- Không gỡ lớp bảo vệ khi còn tài khoản chưa hoàn thành đổi mật khẩu.
begin;
do $guard$
begin
  if exists(select 1 from public.profiles where must_change_password) then
    raise exception 'Còn tài khoản chưa đổi mật khẩu. Không thể gỡ lớp bảo vệ.';
  end if;
end;
$guard$;

drop trigger pos_finish_initial_password_setup on auth.users;
drop function public.finish_initial_password_setup();

create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = ''
as $function$
  select role from public.profiles
  where id = (select auth.uid())
    and is_active = true;
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
      and p_permission = any(r.permissions)
  );
$function$;

create or replace function public.get_my_access()
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

alter table public.profiles
  drop constraint profiles_owner_password_ready,
  drop column must_change_password;
commit;
