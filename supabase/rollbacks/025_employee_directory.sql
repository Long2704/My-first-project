-- Khôi phục frontend trước 025 cùng lúc. Không xóa tài khoản hoặc dữ liệu.
begin;
drop function public.list_employees(text,text,boolean,integer,integer);
commit;
