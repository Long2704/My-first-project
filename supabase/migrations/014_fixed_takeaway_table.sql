-- Chạy sau 013. Thêm một bàn cố định Mang về, không xóa hóa đơn/đơn cũ.
begin;
lock table public.restaurant_tables in share row exclusive mode;
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
create function public.audit_place_label() returns trigger language plpgsql security definer set search_path='' as $$
declare v_label text;
begin
 select name into v_label from public.restaurant_tables where id=new.table_no;
 if v_label is not null then new.extra:=new.extra||jsonb_build_object('place_label',v_label);end if;
 return new;
end;
$$;
create trigger audit_place_label before insert on public.audit_log for each row execute function public.audit_place_label();
commit;
