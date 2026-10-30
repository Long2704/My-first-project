-- Sau 025. Chỉ chạy trên project thử nghiệm trước.
-- Không đánh dấu lại tài khoản cũ: giá trị mặc định false giữ nguyên quyền cũ.
begin;

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

commit;
