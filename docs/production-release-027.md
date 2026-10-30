# Chuẩn bị đưa bản quản lý nhân viên lên production

Người dùng đã cho phép hoàn thành phần tạo tài khoản và đưa lên bản thật. Không cần hỏi lại quyền triển khai. Trạng thái hiện tại: mã đã chuẩn bị, chưa triển khai production vì không có kết nối quản trị Supabase/Vercel trong môi trường. GitHub có thể truy cập nhưng merge main có thể tự kích hoạt Vercel; không merge khi database còn thiếu migration.

## Mã nguồn và phụ thuộc
Production main đang ở 94cb7aa35f12a21ea1b19168cd2522f2356fd9bd, tương ứng giao diện cũ trước 017. Nhánh phát hành phải chứa cả 017–027 và các sửa giao diện đã được người dùng áp dụng trên staging, không chỉ file 027. Không chép dữ liệu hoặc tài khoản thử nghiệm sang production. Không thay URL/key production bằng .env.local staging.

## Thứ tự triển khai
1. Xác định đúng Supabase project phục vụ Vercel production và migration đã có bằng SQL preflight chỉ đọc. Không suy đoán production đang giống staging.
2. Lưu bản sao schema và dữ liệu production mới nhất, cùng các file Edge Function đang deploy và commit Vercel hiện tại. Backup giữ riêng trên máy người dùng/nơi được bảo vệ, không upload secrets, auth dump hay dữ liệu khách lên GitHub/chat. Backup public trước đây không bao gồm Auth. Cần có phương án giữ/khôi phục tài khoản Auth trước khi thao tác schema Auth.
3. Kiểm tra không còn tài khoản thu_ngan đang dùng: không tự chuyển quyền cho tài khoản cũ. Giữ nguyên cashier_id và lịch sử thanh toán. Sắp thời điểm ít khách; đợi các yêu cầu gọi món/thanh toán đang chờ hoàn tất.
4. Áp dụng đúng các migration còn thiếu từ 017 tới 027 trên production. Không chạy lại toàn bộ nếu một phần đã tồn tại. Không dùng database reset hoặc push --include-all một cách mù quáng; repo thiếu schema Auth/profiles nền nên không tạo lại database từ đầu.
5. Deploy staff-admin của production với mã 027; dùng biến server mặc định, không nhập key vào mã. Tắt public signup production. Confirm email có thể giữ bật; Admin create email_confirm=true dùng cho tài khoản Owner cấp trực tiếp, không gửi thư mời.
6. Sau database và Edge Function sẵn sàng, merge nhánh phát hành vào main để Vercel build/deploy với biến môi trường production hiện có. Theo dõi build/deployment thực tế, chỉ báo hoàn tất sau khi có bằng chứng deployment Ready và kiểm tra lỗi vận hành bằng kết nối hợp lệ. Không tạo đơn/thanh toán giả trên production.

## SQL preflight chỉ đọc
```sql
select column_name,data_type from information_schema.columns
where table_schema='public' and table_name='profiles' order by ordinal_position;
select role,is_active,count(*) from public.profiles group by role,is_active;
```
Câu thứ hai chỉ dùng khi is_active đã tồn tại; nếu chưa, dùng:
```sql
select role,count(*) from public.profiles group by role;
```
Kiểm tra helper và Auth triggers:
```sql
select proname,pg_get_function_identity_arguments(oid) arguments
from pg_proc where pronamespace='public'::regnamespace
and proname in ('has_permission','get_my_access','prepare_employee_creation','current_staff_role');
select tgname,pg_get_triggerdef(oid) definition
from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal;
```
Nếu có trigger tự tạo profiles khác, phải đối chiếu trước 027 để không xung đột INSERT. Kiểm tra constraint audit_log/profiles, RLS và grants với schema dump hiện hành trước khi áp dụng.

## Quay lại
Nếu giao diện có lỗi, rollback deployment Vercel về commit đã lưu, không xóa dữ liệu. Nếu lỗi tạo nhân viên, khôi phục staff-admin auth-only trước rồi rollback 027 (giữ tài khoản và ledger). Những migration phân quyền 017–026 không được tự gỡ theo dây chuyền: 026 rollback chặn khi còn tài khoản chưa đổi mật khẩu, và rollback quyền cũ có thể mở lại truy cập ngoài ý muốn. Không restore public-data cũ đè lên giao dịch mới phát sinh. Ưu tiên sửa tiến hoặc rollback riêng giao diện/chức năng mới.
