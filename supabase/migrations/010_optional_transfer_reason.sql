-- Chạy sau 009_split_bills.sql. Không sửa/xóa lịch sử chuyển bàn cũ.
begin;
alter table public.table_transfers drop constraint table_transfers_reason_check;
alter table public.table_transfers add constraint table_transfers_reason_check check(length(btrim(reason))<=500);
create or replace function public.transfer_table(p_session_id uuid,p_from_table integer,p_to_table integer,p_request_id uuid,p_reason text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_existing public.table_transfers%rowtype; v_session public.table_sessions%rowtype;
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
   or v_existing.reason is distinct from btrim(coalesce(p_reason,'')) then
   raise exception 'Mã chuyển bàn đã được sử dụng.';
  end if;
  return v_existing.session_id;
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
 select * into v_session from public.table_sessions where id=p_session_id for update;
 if not found or v_session.closed_at is not null then raise exception 'Phiên bàn đã đóng hoặc không tồn tại.'; end if;
 if v_session.table_id<>p_from_table then raise exception 'Phiên khách đã chuyển sang bàn khác. Đồng bộ và kiểm tra lại.'; end if;
 if exists(select 1 from public.table_sessions where table_id=p_to_table and closed_at is null) then
  raise exception 'Bàn đích đang có khách. Chọn bàn trống khác.';
 end if;
 update public.table_sessions set table_id=p_to_table where id=p_session_id;
 insert into public.table_transfers(request_id,session_id,from_table,to_table,user_id,reason)
 values(p_request_id,p_session_id,p_from_table,p_to_table,v_user,btrim(coalesce(p_reason,'')));
 insert into public.audit_log(type,table_no,session_id,user_id,extra)
 values('table_transfer',p_to_table,p_session_id,v_user,jsonb_build_object('from_table',p_from_table,'to_table',p_to_table,'reason',btrim(coalesce(p_reason,'')),'request_id',p_request_id));
 return p_session_id;
end;
$$;

commit;
