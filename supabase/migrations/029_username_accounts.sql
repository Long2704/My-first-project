-- Sau 028. Giữ email Auth và mã cũ để bảo toàn tài khoản/lịch sử.
begin;
alter table public.profiles add column username text;
update public.profiles set username='nv_'||replace(id::text,'-','');
-- Một Owner hiện có: owner. Nếu có nhiều Owner, giữ tên riêng theo UUID.
update public.profiles set username='owner' where role='chu' and (select count(*) from public.profiles where role='chu')=1;
-- Dùng mã cũ làm tên đăng nhập nếu hợp lệ và không trùng Owner.
update public.profiles p set username=lower(btrim(p.staff_code))
where p.role<>'chu' and lower(btrim(p.staff_code)) ~ '^[a-z0-9][a-z0-9_.-]{2,39}$'
and not exists(select 1 from public.profiles q where q.id<>p.id and q.username=lower(btrim(p.staff_code)));
alter table public.profiles alter column username set not null;
alter table public.profiles alter column username set default ('nv_'||replace(gen_random_uuid()::text,'-',''));
alter table public.profiles add constraint profiles_username_valid check(username=lower(btrim(username)) and username ~ '^[a-z0-9][a-z0-9_.-]{2,39}$');
create unique index profiles_username_unique on public.profiles(username);
alter table public.employee_creation_requests add column username text unique;

create function public.prepare_employee_account(p_request_id uuid,p_username text,p_name text,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u text:=lower(btrim(p_username)); r public.employee_creation_requests%rowtype; v_result jsonb;
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Chỉ Owner đang hoạt động được tạo nhân viên.';end if;
 if u is null or u !~ '^[a-z0-9][a-z0-9_.-]{2,39}$' or p_request_id is null then raise exception 'Tên đăng nhập cần 3–40 ký tự, gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u,29));
 select * into r from public.employee_creation_requests where request_id=p_request_id;
 if found and r.username is distinct from u then raise exception 'Mã yêu cầu đã được sử dụng cho thông tin khác.';end if;
 if exists(select 1 from public.profiles where username=u and (r.user_id is null or id<>r.user_id)) then raise exception 'Tên đăng nhập đã được sử dụng.';end if;
 v_result:=public.prepare_employee_creation(p_request_id,p_request_id::text||'@staff.pos.invalid',upper(replace(p_request_id::text,'-','')),p_name,p_role);
 update public.employee_creation_requests set username=u where request_id=p_request_id;
 return v_result||jsonb_build_object('username',u);
end;
$$;
revoke all on function public.prepare_employee_account(uuid,text,text,text) from public,anon;
grant execute on function public.prepare_employee_account(uuid,text,text,text) to authenticated;

create or replace function public.provision_created_employee()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.employee_creation_requests%rowtype; v_request text;
begin
 v_request:=new.raw_app_meta_data->>'pos_employee_request';
 if v_request is null then return new; end if;
 select * into r from public.employee_creation_requests where request_id=v_request::uuid for update;
 if not found or r.completed_at is not null or lower(new.email) is distinct from r.email then
  raise exception 'Yêu cầu tạo nhân viên không hợp lệ.';
 end if;
 -- Khóa hàng Owner ngăn việc khóa/hạ quyền đồng thời trong lúc cấp tài khoản.
 perform 1 from public.profiles where id=r.owner_id and role='chu' and is_active=true and must_change_password=false for share;
 if not found then raise exception 'Owner không còn quyền tạo nhân viên.'; end if;
 if coalesce(new.encrypted_password,'')='' then raise exception 'Thiếu mật khẩu tạm.'; end if;
 insert into public.profiles(id,name,staff_code,role,is_active,must_change_password,username)
 values(new.id,r.name,r.staff_code,r.role,true,true,coalesce(r.username,'nv_'||replace(new.id::text,'-','')));
 insert into public.audit_log(type,user_id,extra)
 values('employee_created',r.owner_id,jsonb_build_object('employee_id',new.id,'username',coalesce(r.username,'nv_'||replace(new.id::text,'-','')),'role',r.role,'request_id',r.request_id));
 update public.employee_creation_requests set user_id=new.id,completed_at=now() where request_id=r.request_id;
 return new;
end;
$$;
revoke all on function public.provision_created_employee() from public,anon,authenticated;

create function public.update_employee_account(p_request_id uuid,p_employee_id uuid,p_expected_version integer,p_name text,p_username text,p_role text,p_is_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_row public.profiles%rowtype; new_row public.profiles%rowtype;
 r public.employee_update_requests%rowtype;
 n text:=btrim(p_name); c text:=lower(btrim(p_username));
 v_payload jsonb; v_result jsonb; v_type text;
begin
 -- Cả kiểm tra lẫn replay đều phải có Owner còn hoạt động.
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Chỉ Owner đang hoạt động được quản lý nhân viên.';end if;
 perform 1 from public.profiles where id=auth.uid() and role='chu' and is_active and not must_change_password for share;
 if not found then raise exception 'Owner không còn quyền quản lý nhân viên.';end if;
 if p_request_id is null or p_employee_id is null or p_expected_version is null or p_expected_version<1
 or n is null or char_length(n) not between 1 and 100
 or c is null or c !~ '^[a-z0-9][a-z0-9_.-]{2,39}$'
 or p_role is null or p_role not in ('phuc_vu','bep') or p_is_active is null then raise exception 'Thông tin nhân viên không hợp lệ.';end if;
 v_payload:=jsonb_build_object('action','update_account','employee_id',p_employee_id,'version',p_expected_version,'name',n,'username',c,'role',p_role,'is_active',p_is_active);
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
 if exists(select 1 from public.employee_creation_requests where username=c and (user_id is null or user_id<>p_employee_id)) then
  raise exception 'Tên đăng nhập đã được sử dụng hoặc đang được tạo.';
 end if;
 update public.profiles set name=n,username=c,role=p_role,is_active=p_is_active where id=p_employee_id returning * into new_row;
 v_result:=jsonb_build_object('ok',true,'employee_id',new_row.id,'staff_version',new_row.staff_version);
 v_type:=case when old_row.is_active and not new_row.is_active then 'employee_locked' when not old_row.is_active and new_row.is_active then 'employee_unlocked' else 'employee_updated' end;
 insert into public.audit_log(type,user_id,extra) values(v_type,auth.uid(),jsonb_build_object('employee_id',new_row.id,'request_id',p_request_id,
  'before',jsonb_build_object('name',old_row.name,'username',old_row.username,'role',old_row.role,'is_active',old_row.is_active),
  'after',jsonb_build_object('name',new_row.name,'username',new_row.username,'role',new_row.role,'is_active',new_row.is_active)));
 insert into public.employee_update_requests(request_id,owner_id,employee_id,payload,result) values(p_request_id,auth.uid(),p_employee_id,v_payload,v_result);
 return v_result;
end;
$$;
revoke all on function public.update_employee_account(uuid,uuid,integer,text,text,text,boolean) from public,anon;
grant execute on function public.update_employee_account(uuid,uuid,integer,text,text,text,boolean) to authenticated;


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
    select p.id, p.name, p.staff_code, p.role, p.is_active, p.created_at, p.staff_version, p.username
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



-- Resolver riêng cho Edge Function đăng nhập. Không public hóa danh sách/email.
create table public.staff_login_limits(bucket text primary key,window_started timestamptz not null,attempts integer not null);
alter table public.staff_login_limits enable row level security;
revoke all on public.staff_login_limits from public,anon,authenticated;
create function public.resolve_staff_login(p_login text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v text:=lower(btrim(p_login)); t timestamptz:=clock_timestamp(); n integer; e text;
begin
 if v is null or char_length(v) not between 1 and 254 then return jsonb_build_object('allowed',false);end if;
 -- Ngưỡng chung giới hạn số bucket mới do request tên ngẫu nhiên.
 insert into public.staff_login_limits values('global',t,1)
 on conflict(bucket) do update set
 attempts=case when staff_login_limits.window_started<t-interval '1 minute' then 1 else staff_login_limits.attempts+1 end,
 window_started=case when staff_login_limits.window_started<t-interval '1 minute' then t else staff_login_limits.window_started end
 returning attempts into n;
 if n>100 then return jsonb_build_object('allowed',false);end if;
 delete from public.staff_login_limits where window_started<t-interval '2 minutes' and bucket<>'global';
 insert into public.staff_login_limits values('login:'||md5(v),t,1)
 on conflict(bucket) do update set
 attempts=case when staff_login_limits.window_started<t-interval '1 minute' then 1 else staff_login_limits.attempts+1 end,
 window_started=case when staff_login_limits.window_started<t-interval '1 minute' then t else staff_login_limits.window_started end
 returning attempts into n;
 if n>10 then return jsonb_build_object('allowed',false);end if;
 select a.email into e from public.profiles p join auth.users a on a.id=p.id
 where p.is_active and (p.username=v or (position('@' in v)>0 and lower(a.email)=v)) limit 1;
 return jsonb_build_object('allowed',true,'email',e);
end;
$$;
revoke all on function public.resolve_staff_login(text) from public,anon,authenticated;
grant execute on function public.resolve_staff_login(text) to service_role;
commit;
