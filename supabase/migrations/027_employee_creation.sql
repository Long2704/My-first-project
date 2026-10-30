-- Sau 026. Không sửa tài khoản, hóa đơn hoặc đơn hàng hiện có.
begin;
create table if not exists public.employee_creation_requests (
 request_id uuid primary key,
 owner_id uuid not null references public.profiles(id),
 email text not null unique,
 staff_code text not null,
 name text not null,
 role text not null check(role in ('phuc_vu','bep')),
 user_id uuid unique,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check ((user_id is null) = (completed_at is null))
);
create unique index if not exists employee_creation_code_unique on public.employee_creation_requests(lower(staff_code));
alter table public.employee_creation_requests enable row level security;
revoke all on public.employee_creation_requests from public,anon,authenticated;

create or replace function public.prepare_employee_creation(p_request_id uuid,p_email text,p_staff_code text,p_name text,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_creation_requests%rowtype;
 e text:=lower(btrim(p_email)); c text:=upper(btrim(p_staff_code)); n text:=btrim(p_name);
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then
  raise exception 'Chỉ Owner đang hoạt động được tạo nhân viên.';
 end if;
 if p_request_id is null or e is null or char_length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or c is null or c !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' or n is null or char_length(n) not between 1 and 100
 or p_role is null or p_role not in ('phuc_vu','bep') then raise exception 'Thông tin nhân viên không hợp lệ.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,27));
 select * into r from public.employee_creation_requests where request_id=p_request_id;
 if found then
  if r.owner_id<>auth.uid() or r.email<>e or r.staff_code<>c or r.name<>n or r.role<>p_role then
   raise exception 'Mã yêu cầu đã được sử dụng cho thông tin khác.';
  end if;
 else
  if exists(select 1 from public.profiles where lower(btrim(staff_code))=lower(c)) then
   raise exception 'Mã nhân viên đã tồn tại.';
  end if;
  insert into public.employee_creation_requests(request_id,owner_id,email,staff_code,name,role)
   values(p_request_id,auth.uid(),e,c,n,p_role) returning * into r;
 end if;
 return jsonb_build_object('request_id',r.request_id,'user_id',r.user_id,'completed',r.completed_at is not null);
end;
$$;
revoke all on function public.prepare_employee_creation(uuid,text,text,text,text) from public,anon;
grant execute on function public.prepare_employee_creation(uuid,text,text,text,text) to authenticated;

create or replace function public.cancel_employee_creation(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_creation_requests%rowtype;
begin
 if public.current_staff_role() is distinct from 'chu' or not public.has_permission('employees.manage') then raise exception 'Không có quyền.'; end if;
 select * into r from public.employee_creation_requests where request_id=p_request_id and owner_id=auth.uid() for update;
 if found and r.completed_at is not null then return jsonb_build_object('completed',true,'user_id',r.user_id); end if;
 delete from public.employee_creation_requests where request_id=p_request_id and owner_id=auth.uid() and completed_at is null;
 return jsonb_build_object('released',true);
end;
$$;
revoke all on function public.cancel_employee_creation(uuid) from public,anon;
grant execute on function public.cancel_employee_creation(uuid) to authenticated;

-- Auth tạo user + profile + nhật ký + đánh dấu hoàn tất trong cùng transaction.
-- Chỉ tin metadata ứng dụng do Admin API thiết lập; không đọc user_metadata.
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
 insert into public.profiles(id,name,staff_code,role,is_active,must_change_password)
 values(new.id,r.name,r.staff_code,r.role,true,true);
 insert into public.audit_log(type,user_id,extra)
 values('employee_created',r.owner_id,jsonb_build_object('employee_id',new.id,'staff_code',r.staff_code,'role',r.role,'request_id',r.request_id));
 update public.employee_creation_requests set user_id=new.id,completed_at=now() where request_id=r.request_id;
 return new;
end;
$$;
revoke all on function public.provision_created_employee() from public,anon,authenticated;
drop trigger if exists pos_provision_created_employee on auth.users;
create trigger pos_provision_created_employee after insert on auth.users for each row execute function public.provision_created_employee();
commit;
