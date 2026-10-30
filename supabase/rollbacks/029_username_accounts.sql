-- Chỉ ngừng tạo/sửa theo username; giữ đăng nhập, username, Auth và ledger.
-- Không gỡ staff-login hay resolver nếu đã có nhân viên dùng tên đăng nhập.
begin;
revoke execute on function public.prepare_employee_account(uuid,text,text,text) from authenticated;
revoke execute on function public.update_employee_account(uuid,uuid,integer,text,text,text,boolean) from authenticated;
commit;
-- Để bật lại: GRANT EXECUTE hai hàm trên TO authenticated.
