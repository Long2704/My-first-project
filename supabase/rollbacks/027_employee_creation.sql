-- Tắt chức năng tạo ở Edge/UI trước. Giữ nguyên tài khoản, nhật ký, yêu cầu.
begin;
drop trigger if exists pos_provision_created_employee on auth.users;
drop function if exists public.provision_created_employee();
drop function if exists public.prepare_employee_creation(uuid,text,text,text,text);
drop function if exists public.cancel_employee_creation(uuid);
-- Không xóa bảng lưu yêu cầu hoặc tài khoản nhân viên đã tạo.
commit;
