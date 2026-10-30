# Owner tạo nhân viên — 027

## Phạm vi đã xây dựng
Owner đang hoạt động tạo Waiter hoặc Kitchen với tên, mã, email đăng nhập và mật khẩu tạm. Không tạo Owner hoặc Cashier. Mật khẩu chỉ đi qua HTTPS tới Edge Function rồi Auth Admin, không ghi vào database ứng dụng, localStorage, nhật ký hoặc phản hồi. Supabase Auth lưu hash. Nhân viên phải đổi mật khẩu trước khi dùng POS (026).

Backend tự xác minh JWT qua Auth, kiểm tra get_my_access, rồi gọi prepare_employee_creation bằng chính JWT đó. Chỉ lời gọi Auth Admin sử dụng SUPABASE_SERVICE_ROLE_KEY mặc định của Edge Function. Không thêm key vào frontend hoặc file VITE_*.

Database giữ yêu cầu không chứa mật khẩu. Trigger auth.users INSERT nhận mã yêu cầu từ app_metadata do Admin API gán, khóa yêu cầu, kiểm tra lại Owner và email; tạo profile, audit_log employee_created và đánh dấu hoàn tất cùng transaction Auth. Role/name/code lấy từ yêu cầu đã được Owner xác thực; không lấy user_metadata. Nếu lỗi constraint, toàn bộ Auth INSERT bị rollback. Không sửa hoặc reset tài khoản có email đã tồn tại.

Khi mất phản hồi, form giữ mã yêu cầu/thông tin nhân viên theo UUID của Owner, xóa mật khẩu khỏi form và có Kiểm tra lại. Tải lại trang rồi mở Quản lý nhân viên sẽ khôi phục yêu cầu. Kiểm tra lại không gửi mật khẩu và không gọi Admin create. Thử lại cùng yêu cầu yêu cầu nhập lại mật khẩu tạm. Hủy yêu cầu chỉ bỏ reservation chưa hoàn tất; không xóa Auth user/profile đã tạo. Khóa hàng ngăn hủy và trigger cấp tài khoản hoàn tất ngược nhau.

## Cài đặt trên project thử nghiệm đã có 026
1. Chạy supabase/migrations/027_employee_creation.sql trong SQL Editor.
2. Mở Edge Function staff-admin đang có, thay toàn bộ index.ts rồi Deploy updates. Supabase cung cấp SUPABASE_URL, SUPABASE_ANON_KEY và SUPABASE_SERVICE_ROLE_KEY tại server; không sao chép key ra chat hoặc frontend. Giữ cách xác minh JWT gateway đã chạy ở bản auth-only.
3. Thêm src/EmployeeCreate.tsx. Thay src/EmployeeManagement.tsx, src/OperationsPanel.tsx và src/style.css bằng bản mới. Không thay .env.local.
4. npm.cmd run build rồi npm.cmd run dev. Mục Quản lý nhân viên có Thêm nhân viên.

Không yêu cầu người dùng lặp các ca kiểm thử thủ công. Các kiểm tra tự động nằm trong tests/employee-creation-sql.mjs, tests/staff-admin-auth.mjs, tests/staff-admin-create.mjs, tests/employee-create-flow.mjs và các kiểm tra hồi quy POS.

## Kết quả và giới hạn
Đã chạy PGlite, fetch giả lập và Chromium với API giả lập. Chặn vai trò trái phép và Owner bị khóa; tạo cả hai vai trò; retry/mất phản hồi; hồ sơ/quyền tạm/nhật ký; hủy; bảo toàn hóa đơn cũ. Build TypeScript/Vite. Chưa kiểm tra Admin API và trigger 027 trên Supabase thật do môi trường không có kết nối quản trị. Không thể xem kiểm thử giả lập là bằng chứng deploy production.

## Quay lại
Khôi phục Edge Function auth-only và frontend trước 027, rồi chạy supabase/rollbacks/027_employee_creation.sql. Giữ tài khoản, đơn hàng, thanh toán, audit và bảng yêu cầu. Bản rollback chỉ gỡ chức năng tạo mới; nhân viên đã tạo vẫn phải đổi mật khẩu theo 026. Có thể chạy lại 027 để bật lại, không xóa bảng yêu cầu.

Chưa bổ sung form sửa/khóa/mở khóa/đặt lại mật khẩu tại 027. Các chức năng đó là phạm vi kế tiếp, không coi backend tạo tài khoản là đã hoàn tất mọi yêu cầu quản trị nhân viên ban đầu.
