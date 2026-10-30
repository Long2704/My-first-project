-- Sau 027, chạy một lần trên bản thật trước khi cập nhật giao diện.
begin;
alter table public.profiles add column staff_version integer not null default 1 check(staff_version>0);
create function public.bump_staff_version() returns trigger language plpgsql set search_path='' as $$
begin new.staff_version:=old.staff_version+1;return new;end;
$$;
revoke all on function public.bump_staff_version() from public,anon,authenticated;
create trigger pos_bump_staff_version before update on public.profiles for each row execute function public.bump_staff_version();

create table public.employee_update_requests(
 request_id uuid primary key,
 owner_id uuid not null references public.profiles(id),
 employee_id uuid not null references public.profiles(id),
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.employee_update_requests enable row level security;
revoke all on public.employee_update_requests from public,anon,authenticated;

create function public.update_employee(p_request_id uuid,p_employee_id uuid,p_expected_version integer,p_name text,p_staff_code text,p_role text,p_is_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_row public.profiles%rowtype; new_row public.profiles%rowtype;
 r public.employee_update_requests%rowtype;
 n text:=btrim(p_name); c text:=upper(btrim(p_staff_code));
 v_payload jsonb; v_result jsonb; v_type text;
begin
 -- Cả kiểm tra lẫn replay đều phải có Owner còn hoạt động.
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Chỉ Owner đang hoạt động được quản lý nhân viên.';end if;
 perform 1 from public.profiles where id=auth.uid() and role='chu' and is_active and not must_change_password for share;
 if not found then raise exception 'Owner không còn quyền quản lý nhân viên.';end if;
 if p_request_id is null or p_employee_id is null or p_expected_version is null or p_expected_version<1
 or n is null or char_length(n) not between 1 and 100
 or c is null or c !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'
 or p_role is null or p_role not in ('phuc_vu','bep') or p_is_active is null then raise exception 'Thông tin nhân viên không hợp lệ.';end if;
 v_payload:=jsonb_build_object('employee_id',p_employee_id,'version',p_expected_version,'name',n,'staff_code',c,'role',p_role,'is_active',p_is_active);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,28));
 select * into r from public.employee_update_requests where request_id=p_request_id;
 if found then
  if r.owner_id<>auth.uid() or r.payload<>v_payload then raise exception 'Mã yêu cầu đã được sử dụng cho thông tin khác.';end if;
  return r.result;
 end if;
 select * into old_row from public.profiles where id=p_employee_id for update;
 if not found then raise exception 'Không tìm thấy nhân viên.';end if;
 if old_row.role not in ('phuc_vu','bep') or old_row.id=auth.uid() then raise exception 'Không được sửa, đổi quyền hoặc khóa Owner hay tài khoản vai trò cũ tại đây.';end if;
 if old_row.staff_version<>p_expected_version then raise exception 'Thông tin nhân viên đã thay đổi. Đóng cửa sổ và tải lại danh sách trước khi sửa.';end if;
 if exists(select 1 from public.employee_creation_requests where lower(staff_code)=lower(c) and (user_id is null or user_id<>p_employee_id)) then
  raise exception 'Mã nhân viên đã được sử dụng hoặc đang được tạo.';
 end if;
 update public.profiles set name=n,staff_code=c,role=p_role,is_active=p_is_active where id=p_employee_id returning * into new_row;
 v_result:=jsonb_build_object('ok',true,'employee_id',new_row.id,'staff_version',new_row.staff_version);
 v_type:=case when old_row.is_active and not new_row.is_active then 'employee_locked' when not old_row.is_active and new_row.is_active then 'employee_unlocked' else 'employee_updated' end;
 insert into public.audit_log(type,user_id,extra) values(v_type,auth.uid(),jsonb_build_object('employee_id',new_row.id,'request_id',p_request_id,
  'before',jsonb_build_object('name',old_row.name,'staff_code',old_row.staff_code,'role',old_row.role,'is_active',old_row.is_active),
  'after',jsonb_build_object('name',new_row.name,'staff_code',new_row.staff_code,'role',new_row.role,'is_active',new_row.is_active)));
 insert into public.employee_update_requests(request_id,owner_id,employee_id,payload,result) values(p_request_id,auth.uid(),p_employee_id,v_payload,v_result);
 return v_result;
end;
$$;
revoke all on function public.update_employee(uuid,uuid,integer,text,text,text,boolean) from public,anon;
grant execute on function public.update_employee(uuid,uuid,integer,text,text,text,boolean) to authenticated;

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
    select p.id, p.name, p.staff_code, p.role, p.is_active, p.created_at, p.staff_version
    from public.profiles p
    where (p_role is null or p.role = p_role)
      and (p_active is null or p.is_active = p_active)
      and (
        v_search = ''
        or strpos(lower(p.name), lower(v_search)) > 0
        or strpos(lower(coalesce(p.staff_code, '')), lower(v_search)) > 0
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
