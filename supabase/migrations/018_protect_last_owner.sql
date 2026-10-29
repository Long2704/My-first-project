begin;

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

commit;
