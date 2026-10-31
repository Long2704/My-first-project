-- Không khôi phục Auth soft-deleted hoặc bỏ các bảo vệ đã xóa.
begin;
do $$begin
 if exists(select 1 from public.employee_account_deletions where completed_at is null) then raise exception 'Còn yêu cầu xóa đang chờ. Hoàn tất bằng backend hiện tại trước khi tắt.';end if;
end$$;
revoke execute on function public.begin_employee_deletion(uuid,uuid,integer) from authenticated;
commit;
-- Giữ ledger, guard, hồ sơ và lịch sử. Không mở khóa tài khoản đã xóa.
