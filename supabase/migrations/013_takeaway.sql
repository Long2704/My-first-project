-- Chạy sau 012. Các mã âm là điểm nhận đơn mang về, không phải bàn vật lý.
begin;
alter table public.restaurant_tables add column service_type text not null default 'dine_in'
 check (service_type in ('dine_in','takeaway'));
alter table public.restaurant_tables add constraint service_identity check ((service_type='takeaway' and id<0) or (service_type='dine_in' and id>0));
revoke insert,update,delete on public.restaurant_tables from public,anon,authenticated;
create sequence public.takeaway_number_seq as integer;
revoke all on sequence public.takeaway_number_seq from public,anon,authenticated;
create table public.takeaway_requests (
 request_id uuid primary key,user_id uuid not null references public.profiles(id),
 session_id uuid not null references public.table_sessions(id),customer_note text not null,
 created_at timestamptz not null default now()
);
alter table public.takeaway_requests enable row level security;
revoke all on public.takeaway_requests from public,anon,authenticated;
grant select on public.takeaway_requests to authenticated;
create policy takeaway_requests_read on public.takeaway_requests for select to authenticated
 using(user_id=auth.uid() or public.current_staff_role() in ('chu','thu_ngan'));
create function public.create_takeaway(p_request_id uuid,p_customer_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_existing public.takeaway_requests%rowtype;v_table integer;v_session uuid;v_name text;
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan','phuc_vu') then raise exception 'Bạn không có quyền tạo đơn mang về.';end if;
 if p_request_id is null or length(btrim(coalesce(p_customer_note,'')))>120 then raise exception 'Thông tin đơn mang về không hợp lệ.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.takeaway_requests where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.customer_note<>btrim(coalesce(p_customer_note,'')) then raise exception 'Mã tạo đơn đã được sử dụng.';end if;
  v_session:=v_existing.session_id;
 else
  v_table:=-pg_catalog.nextval('public.takeaway_number_seq')::integer;
  v_name:='Mang về #'||(-v_table)::text||case when btrim(coalesce(p_customer_note,''))='' then '' else ' · '||btrim(p_customer_note) end;
  insert into public.restaurant_tables(id,name,is_active,service_type) overriding system value values(v_table,v_name,true,'takeaway');
  insert into public.table_sessions(table_id,table_path) values(v_table,array[v_table]) returning id into v_session;
  insert into public.takeaway_requests(request_id,user_id,session_id,customer_note) values(p_request_id,v_user,v_session,btrim(coalesce(p_customer_note,'')));
  insert into public.audit_log(type,table_no,session_id,user_id,extra) values('takeaway_created',v_table,v_session,v_user,jsonb_build_object('name',v_name));
 end if;
 return (select jsonb_build_object('id',t.id,'name',t.name,'session_id',s.id,'closed',s.closed_at is not null)
  from public.table_sessions s join public.restaurant_tables t on t.id=s.table_id where s.id=v_session);
end;
$$;
revoke all on function public.create_takeaway(uuid,text) from public,anon;
grant execute on function public.create_takeaway(uuid,text) to authenticated;

-- Đóng đơn khi đã trả hết/hủy hết: mã cũ không được mở lại cho lượt khách mới.
create function public.retire_takeaway() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.closed_at is not null and old.closed_at is null then
  update public.restaurant_tables set is_active=false where id=new.table_id and service_type='takeaway';
 end if;
 return new;
end;
$$;
create trigger retire_takeaway after update of closed_at on public.table_sessions for each row execute function public.retire_takeaway();
create function public.close_empty_takeaway(p_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_table integer;v_user uuid:=auth.uid();
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan','phuc_vu') then raise exception 'Bạn không có quyền bỏ đơn mang về.';end if;
 select s.table_id into v_table from public.table_sessions s join public.restaurant_tables t on t.id=s.table_id
  where s.id=p_session_id and t.service_type='takeaway';
 if not found then raise exception 'Không tìm thấy đơn mang về.';end if;
 if public.current_staff_role()='phuc_vu' and not exists(select 1 from public.takeaway_requests where session_id=p_session_id and user_id=v_user) then raise exception 'Bạn chỉ được bỏ đơn trống do mình tạo.';end if;
 perform 1 from public.restaurant_tables where id=v_table for update;
 perform 1 from public.table_sessions where id=p_session_id for update;
 if exists(select 1 from public.table_sessions where id=p_session_id and closed_at is not null) then return;end if;
 if exists(select 1 from public.orders where session_id=p_session_id) then raise exception 'Đơn đã gửi món. Thu ngân có thể hủy đơn trong Thao tác bàn.';end if;
 update public.table_sessions set closed_at=now() where id=p_session_id;
 insert into public.audit_log(type,table_no,session_id,user_id) values('takeaway_discarded',v_table,p_session_id,v_user);
end;
$$;
revoke all on function public.close_empty_takeaway(uuid) from public,anon;
grant execute on function public.close_empty_takeaway(uuid) to authenticated;

-- Nhãn đơn/biên lai là snapshot, vẫn đọc được khi đơn đã đóng.
alter table public.orders add column service_label text not null default '';
alter table public.bills add column service_label text not null default '';
create function public.snapshot_service_label() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select case when t.service_type='takeaway' then t.name else '' end into new.service_label
  from public.table_sessions s join public.restaurant_tables t on t.id=s.table_id where s.id=new.session_id;
 return new;
end;
$$;
create trigger orders_service_label before insert on public.orders for each row execute function public.snapshot_service_label();
create trigger bills_service_label before insert on public.bills for each row execute function public.snapshot_service_label();
-- Không chuyển/gộp giữa đơn mang về và bàn ăn, kể cả gọi trực tiếp RPC.
alter function public.transfer_table(uuid,integer,integer,uuid,text,uuid) rename to transfer_dine_in_internal;
revoke all on function public.transfer_dine_in_internal(uuid,integer,integer,uuid,text,uuid) from public,anon,authenticated;
create function public.transfer_table(p_session_id uuid,p_from_table integer,p_to_table integer,p_request_id uuid,p_reason text default '',p_expected_target_session uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then raise exception 'Bạn không có quyền chuyển bàn.';end if;
 if exists(select 1 from public.restaurant_tables where id in (p_from_table,p_to_table) and service_type='takeaway') then raise exception 'Đơn mang về không dùng chuyển bàn.';end if;
 return public.transfer_dine_in_internal(p_session_id,p_from_table,p_to_table,p_request_id,p_reason,p_expected_target_session);
end;
$$;
revoke all on function public.transfer_table(uuid,integer,integer,uuid,text,uuid) from public,anon;
grant execute on function public.transfer_table(uuid,integer,integer,uuid,text,uuid) to authenticated;
commit;
