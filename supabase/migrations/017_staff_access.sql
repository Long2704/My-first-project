begin;

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

commit;
