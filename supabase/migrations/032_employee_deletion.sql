-- Sau 031. Xóa quyền đăng nhập bằng Auth soft-delete, giữ UUID/hồ sơ/giao dịch.
begin;
alter table public.profiles add column account_deletion_pending boolean not null default false,add column deleted_at timestamptz;
alter table public.profiles add constraint profiles_deleted_locked check((deleted_at is null and not account_deletion_pending) or not is_active);
create table public.employee_account_deletions(
 request_id uuid primary key,employee_id uuid not null references public.profiles(id),
 owner_id uuid not null references public.profiles(id),expected_version integer not null,
 created_at timestamptz not null default now(),completed_at timestamptz,completed_by uuid references public.profiles(id)
);
create unique index employee_one_pending_deletion on public.employee_account_deletions(employee_id) where completed_at is null;
alter table public.employee_account_deletions enable row level security;
revoke all on public.employee_account_deletions from public,anon,authenticated;
create function public.guard_deleted_employee() returns trigger language plpgsql set search_path='' as $$
begin
 if old.deleted_at is not null or old.account_deletion_pending then
  if new.is_active or new.password_reset_pending or new.role<>old.role or new.username<>old.username then raise exception 'Tài khoản đã xóa hoặc đang xóa; không thể mở lại, đổi vai trò hay đặt lại mật khẩu.';end if;
 end if;
 return new;
end;
$$;
revoke all on function public.guard_deleted_employee() from public,anon,authenticated;
create trigger pos_guard_deleted_employee before update on public.profiles for each row execute function public.guard_deleted_employee();

create function public.get_employee_deletion(p_employee_id uuid,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_account_deletions%rowtype;
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Chỉ Owner đang hoạt động được xóa tài khoản.';end if;
 select * into r from public.employee_account_deletions where employee_id=p_employee_id and (p_request_id is null or request_id=p_request_id) order by created_at desc limit 1;
 if not found then return null;end if;
 return jsonb_build_object('request_id',r.request_id,'employee_id',r.employee_id,'expected_version',r.expected_version,'completed',r.completed_at is not null);
end;
$$;
revoke all on function public.get_employee_deletion(uuid,uuid) from public,anon;
grant execute on function public.get_employee_deletion(uuid,uuid) to authenticated;

create function public.begin_employee_deletion(p_request_id uuid,p_employee_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_account_deletions%rowtype;p public.profiles%rowtype;
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Chỉ Owner đang hoạt động được xóa tài khoản.';end if;
 perform 1 from public.profiles where id=auth.uid() and role='chu' and is_active and not must_change_password for share;
 if not found then raise exception 'Owner không còn quyền.';end if;
 if p_request_id is null or p_employee_id is null or p_expected_version is null or p_expected_version<1 then raise exception 'Yêu cầu không hợp lệ.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,32));
 select * into r from public.employee_account_deletions where request_id=p_request_id;
 if found then
  if r.employee_id<>p_employee_id or r.expected_version<>p_expected_version then raise exception 'Mã yêu cầu đã dùng cho thông tin khác.';end if;
  return public.get_employee_deletion(p_employee_id,p_request_id);
 end if;
 select * into p from public.profiles where id=p_employee_id for update;
 if not found or p.role not in ('phuc_vu','bep') or p.id=auth.uid() then raise exception 'Chỉ xóa Waiter hoặc Kitchen, không xóa Owner.';end if;
 select * into r from public.employee_account_deletions where employee_id=p_employee_id order by created_at desc limit 1;
 if found then return public.get_employee_deletion(p_employee_id,r.request_id)||jsonb_build_object('conflict',true);end if;
 if p.password_reset_pending then raise exception 'Hoàn tất đặt lại mật khẩu trước khi xóa tài khoản.';end if;
 if p.staff_version<>p_expected_version then raise exception 'Thông tin nhân viên đã thay đổi. Tải lại danh sách.';end if;
 insert into public.employee_account_deletions(request_id,employee_id,owner_id,expected_version) values(p_request_id,p_employee_id,auth.uid(),p_expected_version);
 update public.profiles set is_active=false,account_deletion_pending=true,staff_sessions_revoked_before=clock_timestamp() where id=p_employee_id;
 delete from auth.sessions where user_id=p_employee_id;
 insert into public.audit_log(type,user_id,extra) values('employee_deletion_started',auth.uid(),jsonb_build_object('employee_id',p_employee_id,'request_id',p_request_id));
 return public.get_employee_deletion(p_employee_id,p_request_id);
end;
$$;
revoke all on function public.begin_employee_deletion(uuid,uuid,integer) from public,anon;
grant execute on function public.begin_employee_deletion(uuid,uuid,integer) to authenticated;

create function public.finish_employee_deletion(p_request_id uuid,p_owner_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_account_deletions%rowtype;
begin
 perform 1 from public.profiles where id=p_owner_id and role='chu' and is_active and not must_change_password for share;
 if not found then raise exception 'Owner không còn quyền.';end if;
 select * into r from public.employee_account_deletions where request_id=p_request_id for update;
 if not found then raise exception 'Không tìm thấy yêu cầu xóa.';end if;
 if r.completed_at is not null then return jsonb_build_object('ok',true,'completed',true);end if;
 if not exists(select 1 from auth.users where id=r.employee_id and deleted_at is not null) then return jsonb_build_object('ok',false,'pending',true);end if;
 perform 1 from public.profiles where id=r.employee_id and role in ('phuc_vu','bep') and account_deletion_pending for update;
 if not found then raise exception 'Trạng thái tài khoản đã thay đổi.';end if;
 delete from auth.sessions where user_id=r.employee_id;
 update public.profiles set is_active=false,account_deletion_pending=false,deleted_at=clock_timestamp(),staff_sessions_revoked_before=clock_timestamp() where id=r.employee_id;
 update public.employee_account_deletions set completed_at=now(),completed_by=p_owner_id where request_id=p_request_id;
 insert into public.audit_log(type,user_id,extra) values('employee_deleted',p_owner_id,jsonb_build_object('employee_id',r.employee_id,'request_id',p_request_id));
 return jsonb_build_object('ok',true,'completed',true);
end;
$$;
revoke all on function public.finish_employee_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_employee_deletion(uuid,uuid) to service_role;

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
    select p.id, p.name, p.staff_code, p.role, p.is_active, p.created_at, p.staff_version, p.username, p.password_reset_pending, p.account_deletion_pending
    from public.profiles p
    where p.deleted_at is null and (p_role is null or p.role = p_role)
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





create or replace function public.finish_initial_password_setup()
returns trigger language plpgsql security definer set search_path='' as $$
declare marker text;is_admin boolean:=false;tx bigint:=txid_current();
begin
 marker:=new.raw_app_meta_data->>'pos_staff_reset_attempt';
 if marker is distinct from (old.raw_app_meta_data->>'pos_staff_reset_attempt') and marker is not null then
  is_admin:=exists(select 1 from public.employee_password_attempts where attempt_id::text=marker and employee_id=new.id);
  if not is_admin then raise exception 'Marker đặt lại mật khẩu không hợp lệ.';end if;
  perform 1 from public.profiles where id=new.id and role in ('phuc_vu','bep') and deleted_at is null and not account_deletion_pending for update;
  if not found then raise exception 'Không đặt lại mật khẩu Owner hoặc tài khoản đã đổi vai trò.';end if;
  update public.profiles set must_change_password=true,staff_admin_password_txid=tx,staff_sessions_revoked_before=clock_timestamp() where id=new.id and role in ('phuc_vu','bep');
  delete from auth.sessions where user_id=new.id;
 end if;
 if new.encrypted_password is distinct from old.encrypted_password and coalesce(new.encrypted_password,'')<>'' then
  update public.profiles set must_change_password=(password_reset_pending or coalesce(staff_admin_password_txid=tx,false) or coalesce(staff_initial_auth_txid=tx,false) or is_admin)
  where id=new.id and role in ('phuc_vu','bep');
 end if;
 return new;
end;
$$;


commit;
