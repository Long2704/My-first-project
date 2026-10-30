-- Sau 029. Không đổi mật khẩu/tài khoản hiện có khi chạy migration.
begin;
alter table public.profiles add column password_reset_pending boolean not null default false,
 add column staff_sessions_revoked_before timestamptz,
 add column staff_admin_password_txid bigint;
alter table public.profiles add constraint profiles_pending_reset_locked check(not password_reset_pending or not is_active);
create table public.employee_password_resets(
 request_id uuid primary key,employee_id uuid not null references public.profiles(id),
 owner_id uuid not null references public.profiles(id),expected_version integer not null,
 was_active boolean not null,created_at timestamptz not null default now(),
 completed_at timestamptz,completed_by uuid references public.profiles(id)
);
create unique index employee_one_pending_password_reset on public.employee_password_resets(employee_id) where completed_at is null;
alter table public.employee_password_resets enable row level security;
revoke all on public.employee_password_resets from public,anon,authenticated;

create function public.guard_pending_password_reset() returns trigger language plpgsql set search_path='' as $$
begin
 if old.password_reset_pending and new.role not in ('phuc_vu','bep') then raise exception 'Hoàn tất đặt lại mật khẩu trước khi đổi vai trò quản trị.';end if;
 if new.password_reset_pending and new.is_active then raise exception 'Nhân viên đang đặt lại mật khẩu. Hoàn tất đặt lại trước khi mở khóa.';end if;
 return new;
end;
$$;
revoke all on function public.guard_pending_password_reset() from public,anon,authenticated;
create trigger pos_guard_pending_password_reset before update on public.profiles for each row execute function public.guard_pending_password_reset();

-- JWT cũ không lấy lại quyền sau khi tài khoản được mở hoặc đổi mật khẩu.
create function public.staff_session_current() returns boolean language plpgsql stable security definer set search_path='' as $$
declare cutoff timestamptz; sid text;
begin
 select staff_sessions_revoked_before into cutoff from public.profiles where id=auth.uid();
 if not found then return false;end if;
 if cutoff is null then return true;end if;
 sid:=auth.jwt()->>'session_id';
 return exists(select 1 from auth.sessions where id::text=sid and user_id=auth.uid() and created_at>cutoff);
end;
$$;
revoke all on function public.staff_session_current() from public,anon;
grant execute on function public.staff_session_current() to authenticated;

create function public.get_employee_password_reset(p_employee_id uuid,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_password_resets%rowtype;
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Chỉ Owner đang hoạt động được đặt lại mật khẩu.';end if;
 select * into r from public.employee_password_resets where employee_id=p_employee_id
 and ((p_request_id is not null and request_id=p_request_id) or (p_request_id is null and completed_at is null)) order by created_at desc limit 1;
 if not found then return null;end if;
 return jsonb_build_object('request_id',r.request_id,'employee_id',r.employee_id,'expected_version',r.expected_version,'completed',r.completed_at is not null);
end;
$$;
revoke all on function public.get_employee_password_reset(uuid,uuid) from public,anon;
grant execute on function public.get_employee_password_reset(uuid,uuid) to authenticated;

create function public.begin_employee_password_reset(p_request_id uuid,p_employee_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_password_resets%rowtype;p public.profiles%rowtype;
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Chỉ Owner đang hoạt động được đặt lại mật khẩu.';end if;
 perform 1 from public.profiles where id=auth.uid() and role='chu' and is_active and not must_change_password for share;
 if not found then raise exception 'Owner không còn quyền.';end if;
 if p_request_id is null or p_employee_id is null or p_expected_version is null or p_expected_version<1 then raise exception 'Yêu cầu không hợp lệ.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,30));
 select * into r from public.employee_password_resets where request_id=p_request_id;
 if found then
  if r.employee_id<>p_employee_id or r.expected_version<>p_expected_version then raise exception 'Mã yêu cầu đã dùng cho thông tin khác.';end if;
  if r.completed_at is null then
   perform 1 from public.profiles where id=p_employee_id and role in ('phuc_vu','bep') and password_reset_pending for update;
   if not found then raise exception 'Trạng thái đặt lại đã thay đổi.';end if;
  end if;
  return public.get_employee_password_reset(p_employee_id,p_request_id);
 end if;
 select * into p from public.profiles where id=p_employee_id for update;
 if not found or p.role not in ('phuc_vu','bep') or p.id=auth.uid() then raise exception 'Chỉ đặt lại mật khẩu cho Waiter hoặc Kitchen, không áp dụng Owner.';end if;
 select * into r from public.employee_password_resets where employee_id=p_employee_id and completed_at is null;
 if found then return public.get_employee_password_reset(p_employee_id,r.request_id)||jsonb_build_object('conflict',true);end if;
 if p.staff_version<>p_expected_version then raise exception 'Thông tin nhân viên đã thay đổi. Tải lại danh sách.';end if;
 insert into public.employee_password_resets(request_id,employee_id,owner_id,expected_version,was_active)
 values(p_request_id,p_employee_id,auth.uid(),p_expected_version,p.is_active);
 update public.profiles set is_active=false,must_change_password=true,password_reset_pending=true,staff_sessions_revoked_before=clock_timestamp() where id=p_employee_id;
 delete from auth.sessions where user_id=p_employee_id;
 insert into public.audit_log(type,user_id,extra) values('employee_password_reset_started',auth.uid(),jsonb_build_object('employee_id',p_employee_id,'request_id',p_request_id));
 return public.get_employee_password_reset(p_employee_id,p_request_id);
end;
$$;
revoke all on function public.begin_employee_password_reset(uuid,uuid,integer) from public,anon;
grant execute on function public.begin_employee_password_reset(uuid,uuid,integer) to authenticated;

-- Mỗi lần Admin đổi mật khẩu có marker riêng, không lẫn với nhân viên tự đổi.
create table public.employee_password_attempts(
 attempt_id uuid primary key default gen_random_uuid(),request_id uuid not null references public.employee_password_resets(request_id),
 employee_id uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.employee_password_attempts enable row level security;
revoke all on public.employee_password_attempts from public,anon,authenticated;
create function public.register_employee_password_attempt(p_request_id uuid,p_owner_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_password_resets%rowtype;v_attempt uuid;
begin
 perform 1 from public.profiles where id=p_owner_id and role='chu' and is_active and not must_change_password for share;
 if not found then raise exception 'Owner không còn quyền.';end if;
 select * into r from public.employee_password_resets where request_id=p_request_id for update;
 if not found then raise exception 'Không tìm thấy yêu cầu.';end if;
 if r.completed_at is not null then return jsonb_build_object('completed',true);end if;
 insert into public.employee_password_attempts(request_id,employee_id) values(r.request_id,r.employee_id) returning attempt_id into v_attempt;
 return jsonb_build_object('attempt_id',v_attempt);
end;
$$;
revoke all on function public.register_employee_password_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_employee_password_attempt(uuid,uuid) to service_role;

-- Hỗ trợ Auth ghi metadata và hash trong một hoặc nhiều UPDATE cùng transaction.
-- Admin đến chậm vẫn bắt đổi lại và thu hồi phiên, kể cả yêu cầu đã được xác nhận.
create or replace function public.finish_initial_password_setup()
returns trigger language plpgsql security definer set search_path='' as $$
declare marker text;is_admin boolean:=false;tx bigint:=txid_current();
begin
 marker:=new.raw_app_meta_data->>'pos_staff_reset_attempt';
 if marker is distinct from (old.raw_app_meta_data->>'pos_staff_reset_attempt') and marker is not null then
  is_admin:=exists(select 1 from public.employee_password_attempts where attempt_id::text=marker and employee_id=new.id);
  if not is_admin then raise exception 'Marker đặt lại mật khẩu không hợp lệ.';end if;
  perform 1 from public.profiles where id=new.id and role in ('phuc_vu','bep') for update;
  if not found then raise exception 'Không đặt lại mật khẩu Owner hoặc tài khoản đã đổi vai trò.';end if;
  update public.profiles set must_change_password=true,staff_admin_password_txid=tx,staff_sessions_revoked_before=clock_timestamp() where id=new.id and role in ('phuc_vu','bep');
  delete from auth.sessions where user_id=new.id;
 end if;
 if new.encrypted_password is distinct from old.encrypted_password and coalesce(new.encrypted_password,'')<>'' then
  update public.profiles set must_change_password=(password_reset_pending or coalesce(staff_admin_password_txid=tx,false) or is_admin)
  where id=new.id and role in ('phuc_vu','bep');
 end if;
 return new;
end;
$$;
drop trigger pos_finish_initial_password_setup on auth.users;
create trigger pos_finish_initial_password_setup after update of encrypted_password,raw_app_meta_data on auth.users for each row execute function public.finish_initial_password_setup();

-- Chỉ backend được xác nhận sau khi Auth Admin trả thành công.
create function public.finish_employee_password_reset(p_request_id uuid,p_owner_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_password_resets%rowtype;
begin
 perform 1 from public.profiles where id=p_owner_id and role='chu' and is_active and not must_change_password for share;
 if not found then raise exception 'Owner không còn quyền.';end if;
 select * into r from public.employee_password_resets where request_id=p_request_id for update;
 if not found then raise exception 'Không tìm thấy yêu cầu đặt lại.';end if;
 if r.completed_at is not null then return jsonb_build_object('ok',true,'completed',true);end if;
 perform 1 from public.profiles where id=r.employee_id and role in ('phuc_vu','bep') and password_reset_pending for update;
 if not found then raise exception 'Trạng thái đặt lại đã thay đổi. Cần kiểm tra.';end if;
 delete from auth.sessions where user_id=r.employee_id;
 update public.profiles set password_reset_pending=false,must_change_password=true,is_active=r.was_active,staff_sessions_revoked_before=clock_timestamp() where id=r.employee_id;
 update public.employee_password_resets set completed_at=now(),completed_by=p_owner_id where request_id=p_request_id;
 insert into public.audit_log(type,user_id,extra) values('employee_password_reset',p_owner_id,jsonb_build_object('employee_id',r.employee_id,'request_id',p_request_id));
 return jsonb_build_object('ok',true,'completed',true);
end;
$$;
revoke all on function public.finish_employee_password_reset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_employee_password_reset(uuid,uuid) to service_role;

create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = ''
as $function$
  select role from public.profiles
  where id = (select auth.uid())
    and is_active = true
    and must_change_password = false
    and (select public.staff_session_current());
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
        'tables.transfer', 'bills.split', 'menu.manage', 'tables.manage',
        'reports.read', 'audit.read', 'employees.manage', 'settings.manage',
        'receipts.read_own', 'receipts.read_all'
      ]::text[]) as permission
      where public.has_permission(permission)
    )
  )
  from public.profiles p where p.id = (select auth.uid());
$function$;


create or replace function public.list_employees(
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
    select p.id, p.name, p.staff_code, p.role, p.is_active, p.created_at, p.staff_version, p.username, p.password_reset_pending
    from public.profiles p
    where (p_role is null or p.role = p_role)
      and (p_active is null or p.is_active = p_active)
      and (
        v_search = ''
        or strpos(lower(p.name), lower(v_search)) > 0
        or strpos(p.username, lower(v_search)) > 0
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




commit;
