-- Sau 030: Auth có thể INSERT user trước, rồi UPDATE metadata/password.
begin;
alter table public.profiles add column staff_initial_auth_txid bigint;

create function public.complete_employee_creation(p_request_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.employee_creation_requests%rowtype; a record;
begin
 select * into r from public.employee_creation_requests where request_id=p_request_id for update;
 if not found then raise exception 'Không tìm thấy yêu cầu cấp tài khoản.';end if;
 select id,email,coalesce(encrypted_password,'')<>'' as has_password,raw_app_meta_data->>'pos_employee_request' as request_marker
 into a from auth.users where id=p_user_id;
 if not found then raise exception 'Không tìm thấy tài khoản Auth.';end if;
 if r.completed_at is not null then
  if r.user_id=p_user_id and exists(select 1 from public.profiles where id=p_user_id) then return true;end if;
  raise exception 'Yêu cầu đã liên kết tài khoản khác hoặc thiếu hồ sơ.';
 end if;
 if lower(a.email) is distinct from r.email or a.request_marker is distinct from r.request_id::text then raise exception 'Tài khoản Auth không khớp yêu cầu cấp.';end if;
 -- Khi Auth chưa ghi mật khẩu, chờ sự kiện UPDATE kế tiếp.
 if not a.has_password then return false;end if;
 perform 1 from public.profiles where id=r.owner_id and role='chu' and is_active and not must_change_password and not password_reset_pending for share;
 if not found then raise exception 'Owner không còn quyền cấp tài khoản.';end if;
 if exists(select 1 from public.profiles where id=p_user_id) then raise exception 'Tài khoản đã có hồ sơ; không ghi đè.';end if;
 insert into public.profiles(id,name,staff_code,role,is_active,must_change_password,username,staff_initial_auth_txid)
 values(p_user_id,r.name,r.staff_code,r.role,true,true,coalesce(r.username,'nv_'||replace(p_user_id::text,'-','')),txid_current());
 insert into public.audit_log(type,user_id,extra) values('employee_created',r.owner_id,jsonb_build_object('employee_id',p_user_id,'username',coalesce(r.username,'nv_'||replace(p_user_id::text,'-','')),'role',r.role,'request_id',r.request_id));
 update public.employee_creation_requests set user_id=p_user_id,completed_at=now() where request_id=r.request_id;
 return true;
end;
$$;
revoke all on function public.complete_employee_creation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_employee_creation(uuid,uuid) to service_role;

create or replace function public.provision_created_employee()
returns trigger language plpgsql security definer set search_path='' as $$
declare marker text;
begin
 marker:=new.raw_app_meta_data->>'pos_employee_request';
 if marker is null then return new;end if;
 perform public.complete_employee_creation(marker::uuid,new.id);
 return new;
end;
$$;
drop trigger if exists pos_provision_created_employee_update on auth.users;
create trigger pos_provision_created_employee_update after update of raw_app_meta_data,encrypted_password on auth.users
for each row when (new.raw_app_meta_data->>'pos_employee_request' is not null)
execute function public.provision_created_employee();

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
  update public.profiles set must_change_password=(password_reset_pending or coalesce(staff_admin_password_txid=tx,false) or coalesce(staff_initial_auth_txid=tx,false) or is_admin)
  where id=new.id and role in ('phuc_vu','bep');
 end if;
 return new;
end;
$$;

commit;
