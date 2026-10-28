-- Chạy sau 013 hoặc 014. Bao gồm sửa giới hạn ID và bàn Mang về của 014.
-- Chạy sau 013. Thêm một bàn cố định Mang về, không xóa hóa đơn/đơn cũ.
begin;
lock table public.restaurant_tables in share row exclusive mode;
-- Bảng gốc có thể giới hạn id trong 1..12. service_identity (013) vẫn kiểm tra
-- id dương cho bàn thường và id âm cho các đơn mang về cũ.
alter table public.restaurant_tables drop constraint if exists restaurant_tables_id_check;
do $$
declare v_id integer;v_seq text;
begin
 select id into v_id from public.restaurant_tables where id>0 and name='Mang về' order by id limit 1;
 if v_id is null then
  select coalesce(max(id),0)+1 into v_id from public.restaurant_tables where id>0;
  insert into public.restaurant_tables(id,name,is_active,service_type) overriding system value values(v_id,'Mang về',true,'dine_in');
 else
  update public.restaurant_tables set is_active=true,service_type='dine_in' where id=v_id;
 end if;
 v_seq:=pg_get_serial_sequence('public.restaurant_tables','id');
 if v_seq is not null then perform pg_catalog.setval(v_seq::regclass,(select max(id) from public.restaurant_tables where id>0),true);end if;
end;
$$;
-- Ngừng mở đơn bằng chức năng cũ. Các đơn có món vẫn được giữ để thu tiền/hủy.
revoke all on function public.create_takeaway(uuid,text) from public,anon,authenticated;
revoke all on function public.close_empty_takeaway(uuid) from public,anon,authenticated;
update public.table_sessions s set closed_at=now()
 from public.restaurant_tables t where s.table_id=t.id and t.service_type='takeaway' and s.closed_at is null
 and not exists(select 1 from public.orders o where o.session_id=s.id);
-- Biên lai giữ tên bàn ở thời điểm thanh toán; đường đi bếp vẫn theo bàn hiện tại.
create or replace function public.snapshot_service_label() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select case when tg_table_name='bills' or t.service_type='takeaway' then t.name else '' end into new.service_label
  from public.table_sessions s join public.restaurant_tables t on t.id=s.table_id where s.id=new.session_id;
 return new;
end;
$$;
create or replace function public.audit_place_label() returns trigger language plpgsql security definer set search_path='' as $$
declare v_label text;
begin
 select name into v_label from public.restaurant_tables where id=new.table_no;
 if v_label is not null then new.extra:=new.extra||jsonb_build_object('place_label',v_label);end if;
 return new;
end;
$$;
drop trigger if exists audit_place_label on public.audit_log;
create trigger audit_place_label before insert on public.audit_log for each row execute function public.audit_place_label();
alter table public.restaurant_tables add column management_version integer not null default 1 check(management_version>0);
create table public.table_changes (
 request_id uuid primary key,user_id uuid not null references public.profiles(id),table_id integer not null references public.restaurant_tables(id),
 payload jsonb not null,created_at timestamptz not null default now()
);
alter table public.table_changes enable row level security;
revoke all on public.table_changes from public,anon,authenticated;
grant select on public.table_changes to authenticated;
create policy table_changes_owner_read on public.table_changes for select to authenticated using(public.current_staff_role()='chu');
create function public.list_table_management() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_staff_role(),'')<>'chu' then raise exception 'Chỉ chủ quán được quản lý bàn.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'is_active',t.is_active,'version',t.management_version,
 'busy',exists(select 1 from public.table_sessions s where s.table_id=t.id and s.closed_at is null)
 or exists(select 1 from public.orders o join public.table_sessions s on s.id=o.session_id where o.status='cooking' and o.kitchen_relevant and (s.table_id=t.id or o.table_path @> array[t.id] or s.table_path @> array[t.id]))) order by t.id),'[]'::jsonb)
 from public.restaurant_tables t where t.id>0);
end;
$$;
create function public.save_restaurant_table(p_request_id uuid,p_table_id integer,p_expected_version integer,p_name text,p_is_active boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_payload jsonb;v_existing public.table_changes%rowtype;v_old public.restaurant_tables%rowtype;v_id integer;v_seq text;
begin
 if v_user is null or coalesce(public.current_staff_role(),'')<>'chu' then raise exception 'Chỉ chủ quán được quản lý bàn.';end if;
 if p_request_id is null or p_expected_version is null or p_is_active is null or p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'Tên bàn phải từ 1 đến 80 ký tự.';end if;
 if (p_table_id is null and p_expected_version<>0) or (p_table_id is not null and (p_table_id<=0 or p_expected_version<=0)) then raise exception 'Thông tin bàn không hợp lệ.';end if;
 v_payload:=jsonb_build_object('id',p_table_id,'version',p_expected_version,'name',btrim(p_name),'active',p_is_active);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.table_changes where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.payload is distinct from v_payload then raise exception 'Mã cập nhật bàn đã được sử dụng.';end if;
  return v_existing.table_id;
 end if;
 -- Mọi cập nhật quản lý bàn đi qua khóa này: không cấp ID hoặc tên trùng.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('goc-pho-table-management',0));
 if p_table_id is not null then
  select * into v_old from public.restaurant_tables where id=p_table_id for update;
  if not found then raise exception 'Không tìm thấy bàn.';end if;
  if v_old.management_version<>p_expected_version then raise exception 'Bàn đã được sửa ở nơi khác. Tải lại danh sách và kiểm tra lại.';end if;
  if exists(select 1 from public.table_sessions where table_id=p_table_id and closed_at is null)
   or exists(select 1 from public.orders o join public.table_sessions s on s.id=o.session_id where o.status='cooking' and o.kitchen_relevant
    and (s.table_id=p_table_id or o.table_path @> array[p_table_id] or s.table_path @> array[p_table_id])) then
   raise exception 'Bàn còn phiên khách hoặc món bếp chưa xong. Chưa thể sửa hoặc ngừng sử dụng.';
  end if;
 end if;
 if exists(select 1 from public.restaurant_tables where id>0 and id is distinct from p_table_id and lower(btrim(name))=lower(btrim(p_name))) then raise exception 'Tên bàn đã tồn tại. Chọn tên khác.';end if;
 if p_table_id is null then
  select coalesce(max(id),0)+1 into v_id from public.restaurant_tables where id>0;
  insert into public.restaurant_tables(id,name,is_active,service_type) overriding system value values(v_id,btrim(p_name),p_is_active,'dine_in');
  v_seq:=pg_get_serial_sequence('public.restaurant_tables','id');
  if v_seq is not null then perform pg_catalog.setval(v_seq::regclass,(select max(id) from public.restaurant_tables where id>0),true);end if;
 else
  v_id:=p_table_id;
  update public.restaurant_tables set name=btrim(p_name),is_active=p_is_active,management_version=management_version+1 where id=v_id;
 end if;
 insert into public.table_changes(request_id,user_id,table_id,payload) values(p_request_id,v_user,v_id,v_payload);
 insert into public.audit_log(type,table_no,user_id,extra) values('table_update',v_id,v_user,jsonb_build_object('action',case when p_table_id is null then 'create' else 'update' end,
 'before',case when p_table_id is null then null else jsonb_build_object('name',v_old.name,'active',v_old.is_active) end,'name',btrim(p_name),'active',p_is_active));
 return v_id;
end;
$$;
revoke all on function public.list_table_management() from public,anon;
revoke all on function public.save_restaurant_table(uuid,integer,integer,text,boolean) from public,anon;
grant execute on function public.list_table_management(),public.save_restaurant_table(uuid,integer,integer,text,boolean) to authenticated;
commit;
