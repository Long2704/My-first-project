-- Khôi phục frontend trước 028 trước. Giữ version và ledger để bảo toàn retry/audit.
begin;
revoke execute on function public.update_employee(uuid,uuid,integer,text,text,text,boolean) from authenticated;
commit;
-- Khi cần bật lại: grant execute on function public.update_employee(uuid,uuid,integer,text,text,text,boolean) to authenticated;
