-- Chỉ dùng cùng frontend trước 023; khôi phục cả quyền đọc rộng cũ.
begin;

create or replace function public.transfer_dine_in_internal(p_session_id uuid,p_from_table integer,p_to_table integer,p_request_id uuid,p_reason text default '',p_expected_target_session uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_existing public.table_transfers%rowtype; v_session public.table_sessions%rowtype; v_target uuid; v_offset integer; v_count integer;
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then
  raise exception 'Bạn không có quyền chuyển bàn.';
 end if;
 if p_request_id is null then raise exception 'Thiếu mã chuyển bàn.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.table_transfers where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.session_id is distinct from p_session_id
   or v_existing.from_table is distinct from p_from_table or v_existing.to_table is distinct from p_to_table
   or v_existing.reason is distinct from btrim(coalesce(p_reason,''))
   or v_existing.target_session_id is distinct from p_expected_target_session then
   raise exception 'Mã chuyển bàn đã được sử dụng.';
  end if;
  return coalesce(v_existing.target_session_id,v_existing.session_id);
 end if;
 if p_session_id is null or p_from_table is null or p_to_table is null or p_from_table=p_to_table then
  raise exception 'Bàn chuyển không hợp lệ.';
 end if;
 if length(btrim(coalesce(p_reason,'')))>500 then
  raise exception 'Lý do chuyển tối đa 500 ký tự.';
 end if;
 -- Khóa cả hai bàn theo id tăng dần, trước phiên khách như gửi đơn/thanh toán.
 perform 1 from public.restaurant_tables where id in (p_from_table,p_to_table) order by id for update;
 if not exists(select 1 from public.restaurant_tables where id=p_to_table and is_active) then
  raise exception 'Bàn đích không hoạt động.';
 end if;
 -- Hai bàn đã khóa: mọi RPC gửi/thanh toán/chuyển đều đi qua khóa bàn.
 perform 1 from public.table_sessions where id=p_session_id or (table_id=p_to_table and closed_at is null) order by id for update;
 select * into v_session from public.table_sessions where id=p_session_id;
 if not found or v_session.closed_at is not null then raise exception 'Phiên bàn đã đóng hoặc không tồn tại.'; end if;
 if v_session.table_id<>p_from_table then raise exception 'Phiên khách đã chuyển sang bàn khác. Đồng bộ và kiểm tra lại.'; end if;
 select id into v_target from public.table_sessions where table_id=p_to_table and closed_at is null;
 if v_target is distinct from p_expected_target_session then
  raise exception 'Bàn đích đã thay đổi. Đồng bộ và chọn lại bàn đích.';
 end if;
 -- Giữ đường đi riêng của từng đơn, kể cả sau khi hai phiên hợp nhất.
 perform 1 from public.orders where session_id in (p_session_id,v_target) order by id for update;
 update public.orders o set table_path=array_append(case when cardinality(o.table_path)>0 then o.table_path
   when cardinality(v_session.table_path)>0 then v_session.table_path else array[p_from_table] end,p_to_table)
  where o.session_id=p_session_id;
 if v_target is null then
  update public.table_sessions set table_id=p_to_table,
   table_path=case when cardinality(table_path)=0 then array[p_from_table,p_to_table] else array_append(table_path,p_to_table) end
   where id=p_session_id;
 else
  perform 1 from public.order_items i join public.orders o on o.id=i.order_id
   where o.session_id in (p_session_id,v_target) order by i.id for update of i;
  -- Mỗi bill chưa trả của bàn nguồn nhận một số mới ở bàn đích.
  select coalesce(max(i.bill_no),0) into v_offset from public.order_items i join public.orders o on o.id=i.order_id where o.session_id=v_target;
  select count(distinct i.bill_no) into v_count from public.order_items i join public.orders o on o.id=i.order_id
   where o.session_id=p_session_id and not i.paid and i.cancelled_at is null;
  if v_offset+v_count>9999 then raise exception 'Bàn đích không thể nhận thêm bill. Chọn bàn khác.'; end if;
  with mapping as (
   select bill_no,v_offset+row_number() over(order by bill_no) as target from (
    select distinct i.bill_no from public.order_items i join public.orders o on o.id=i.order_id
     where o.session_id=p_session_id and not i.paid and i.cancelled_at is null) bills
  )
  update public.order_items i set bill_no=m.target from mapping m,public.orders o
   where i.order_id=o.id and o.session_id=p_session_id and i.bill_no=m.bill_no and not i.paid and i.cancelled_at is null;
  update public.table_sessions set closed_at=now(),table_path=array_append(case when cardinality(table_path)>0 then table_path else array[p_from_table] end,p_to_table) where id=p_session_id;
  update public.orders set session_id=v_target where session_id=p_session_id;
 end if;
 insert into public.table_transfers(request_id,session_id,from_table,to_table,user_id,reason,target_session_id)
 values(p_request_id,p_session_id,p_from_table,p_to_table,v_user,btrim(coalesce(p_reason,'')),v_target);
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('table_transfer',p_to_table,p_session_id,v_user,jsonb_build_object('from_table',p_from_table,'to_table',p_to_table,'reason',btrim(coalesce(p_reason,'')),'request_id',p_request_id,'target_session_id',v_target,'merged',v_target is not null));
 return coalesce(v_target,p_session_id);
end;
$$;

create or replace function public.transfer_table(p_session_id uuid,p_from_table integer,p_to_table integer,p_request_id uuid,p_reason text default '',p_expected_target_session uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then raise exception 'Bạn không có quyền chuyển bàn.';end if;
 if exists(select 1 from public.restaurant_tables where id in (p_from_table,p_to_table) and service_type='takeaway') then raise exception 'Đơn mang về không dùng chuyển bàn.';end if;
 return public.transfer_dine_in_internal(p_session_id,p_from_table,p_to_table,p_request_id,p_reason,p_expected_target_session);
end;
$$;

create or replace function public.move_bill_items(p_session_id uuid,p_request_id uuid,p_from_bill integer,
 p_to_bill integer,p_item_ids uuid[],p_reason text default '')
returns integer language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_table integer; v_ids uuid[]; v_payload jsonb;
 v_existing public.bill_moves%rowtype; v_count integer; v_target integer; v_items jsonb;
begin
 if v_user is null or coalesce(public.current_staff_role(),'') not in ('chu','thu_ngan') then
  raise exception 'Bạn không có quyền tách/gộp bill.';
 end if;
 if p_session_id is null or p_request_id is null or p_from_bill is null or p_from_bill not between 1 and 9999
  or p_to_bill is null or p_to_bill not between 0 and 9999 or p_to_bill=p_from_bill then
  raise exception 'Thông tin bill không hợp lệ.';
 end if;
 if p_item_ids is null or cardinality(p_item_ids) not between 1 and 500 then raise exception 'Chọn từ 1 đến 500 dòng món.'; end if;
 select array_agg(x order by x),count(distinct x) into v_ids,v_count from unnest(p_item_ids) x;
 if v_count<>cardinality(p_item_ids) then raise exception 'Danh sách dòng món bị trùng hoặc không hợp lệ.'; end if;
 if length(btrim(coalesce(p_reason,'')))>500 then raise exception 'Ghi chú tách/gộp tối đa 500 ký tự.'; end if;
 v_payload:=jsonb_build_object('session_id',p_session_id,'from_bill',p_from_bill,'to_bill',p_to_bill,'item_ids',v_ids,'reason',btrim(coalesce(p_reason,'')));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
 select * into v_existing from public.bill_moves where request_id=p_request_id;
 if found then
  if v_existing.user_id<>v_user or v_existing.payload is distinct from v_payload then raise exception 'Mã tách/gộp bill đã được sử dụng.'; end if;
  return v_existing.target_bill;
 end if;
 select table_id into v_table from public.table_sessions where id=p_session_id;
 if not found then raise exception 'Phiên bàn không tồn tại hoặc đã đóng.'; end if;
 perform 1 from public.restaurant_tables where id=v_table for update;
 perform 1 from public.table_sessions where id=p_session_id and closed_at is null for update;
 if not found then raise exception 'Phiên bàn không tồn tại hoặc đã đóng.'; end if;
 if not exists(select 1 from public.table_sessions where id=p_session_id and table_id=v_table) then
  raise exception 'Bàn vừa được chuyển. Đồng bộ và kiểm tra lại.';
 end if;
 perform 1 from public.order_items i join public.orders o on o.id=i.order_id
  where o.session_id=p_session_id and i.id=any(v_ids) for update of i;
 select count(*) into v_count from public.order_items i join public.orders o on o.id=i.order_id
  where o.session_id=p_session_id and i.id=any(v_ids) and i.bill_no=p_from_bill and not i.paid and i.cancelled_at is null;
 if v_count<>cardinality(v_ids) then raise exception 'Món hoặc bill đã thay đổi. Đồng bộ và chọn lại.'; end if;
 if p_to_bill=0 then
  select coalesce(max(i.bill_no),0)+1 into v_target from public.order_items i join public.orders o on o.id=i.order_id where o.session_id=p_session_id;
  if v_target>9999 then raise exception 'Không thể tạo thêm bill trong phiên này.'; end if;
 else
  v_target:=p_to_bill;
  if not exists(select 1 from public.order_items i join public.orders o on o.id=i.order_id
   where o.session_id=p_session_id and i.bill_no=v_target and not i.paid and i.cancelled_at is null) then
   raise exception 'Bill đích không còn món chưa thanh toán. Chọn lại bill đích.';
  end if;
 end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'qty',qty,'price',price) order by id) into v_items from public.order_items where id=any(v_ids);
 update public.order_items set bill_no=v_target where id=any(v_ids);
 insert into public.bill_moves(request_id,session_id,user_id,payload,target_bill) values(p_request_id,p_session_id,v_user,v_payload,v_target);
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('bill_move',v_table,p_session_id,v_user,jsonb_build_object('from_bill',p_from_bill,'to_bill',v_target,'items',v_items,'reason',btrim(coalesce(p_reason,''))));
 return v_target;
end;
$$;

create or replace function public.complete_kitchen_order(p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_table integer; v_session uuid;
begin
 if auth.uid() is null or coalesce(public.current_staff_role(),'') not in ('bep','thu_ngan','chu') then
  raise exception 'Bạn không có quyền hoàn thành đơn bếp.';
 end if;
 select s.table_id,s.id into v_table,v_session from public.orders o join public.table_sessions s on s.id=o.session_id where o.id=p_order_id;
 if not found then raise exception 'Không tìm thấy đơn.'; end if;
 perform 1 from public.restaurant_tables where id=v_table for update;
 perform 1 from public.table_sessions where id=v_session for update;
 if not exists(select 1 from public.table_sessions where id=v_session and table_id=v_table) then
  raise exception 'Bàn vừa được chuyển. Đồng bộ và thử lại.';
 end if;
 perform 1 from public.orders where id=p_order_id for update;
 if not exists(select 1 from public.orders where id=p_order_id and session_id=v_session) then
  raise exception 'Bàn vừa được gộp. Đồng bộ và thử lại.';
 end if;
 update public.orders set status='done',done_at=now() where id=p_order_id and status='cooking';
end;
$$;

alter policy items_staff_read on public.order_items using (
 (select public.current_staff_role()) in ('phuc_vu','thu_ngan','chu')
 or ((select public.current_staff_role())='bep' and category<>'do_uong')
);
alter policy bills_staff_read on public.bills using ((select public.current_staff_role()) in ('phuc_vu','thu_ngan','chu'));
alter policy bill_items_staff_read on public.bill_items using ((select public.current_staff_role()) in ('phuc_vu','thu_ngan','chu'));
alter policy bill_orders_staff_read on public.bill_orders using ((select public.current_staff_role()) in ('phuc_vu','thu_ngan','chu'));
alter policy audit_cashier_read on public.audit_log using ((select public.current_staff_role()) in ('thu_ngan','chu'));
alter policy takeaway_requests_read on public.takeaway_requests using(user_id=auth.uid() or public.current_staff_role() in ('chu','thu_ngan'));

drop function public.get_my_access();
commit;
