-- Ngừng nhận reset mới, giữ mọi bảo vệ phiên/mật khẩu và dữ liệu.
begin;
do $$begin
 if exists(select 1 from public.employee_password_resets where completed_at is null) then
  raise exception 'Còn yêu cầu đặt lại chưa hoàn tất. Hoàn tất bằng backend hiện tại trước khi tắt chức năng.';
 end if;
end$$;
revoke execute on function public.begin_employee_password_reset(uuid,uuid,integer) from authenticated;
revoke execute on function public.register_employee_password_attempt(uuid,uuid) from service_role;
commit;
-- Không xóa ledger, attempts, cột bảo vệ hay khôi phục session đã bị thu hồi.
