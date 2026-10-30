# 028 — Sửa và khóa/mở khóa nhân viên

Áp dụng trực tiếp production sau 027 theo lựa chọn của người dùng. Không yêu cầu người dùng thực hiện kiểm thử thủ công.

## Hành vi
Owner có nút Sửa cho Waiter/Kitchen: đổi tên, mã nhân viên, vai trò giữa hai nhóm, và trạng thái hoạt động. Không có tùy chọn Owner/Cashier, không sửa/khóa Owner hoặc tài khoản vai trò cũ qua RPC này. Không xóa tài khoản, đơn hoặc hóa đơn; không đổi email/mật khẩu ở bước này.

Backend là RPC PostgreSQL update_employee (SECURITY DEFINER, search_path rỗng) được gọi bằng JWT của người đang đăng nhập, không cần thay Edge Function hoặc key. Kiểm tra Owner còn hoạt động và employees.manage, giữ khóa chia sẻ trên Owner đến cuối transaction, rồi khóa hồ sơ cần sửa. Tài khoản bị khóa ngay lập tức mất quyền database qua các helper hiện có, kể cả JWT cũ còn hiệu lực.

staff_version tự tăng khi hồ sơ cập nhật. RPC so phiên bản người sửa đã đọc trước khi lưu, ngăn ghi đè thay đổi từ người khác hoặc từ Auth. Hai yêu cầu cùng mã trả lại cùng kết quả; UUID yêu cầu và payload được lưu trong ledger không có quyền đọc/ghi trực tiếp từ anon/authenticated. Nhật ký lưu người thực hiện, trước/sau và thời gian. Không xóa cờ must_change_password khi mở khóa hoặc đổi vai trò.

Form giữ payload + request UUID trong localStorage theo Owner UUID để khôi phục sau mất kết nối/tải lại, không có mật khẩu. Yêu cầu không rõ kết quả được thử lại cùng mã. Lỗi phiên bản/mã trùng xác định rõ không áp dụng sẽ bỏ pending để người dùng đóng/tải lại và sửa mới. Có thể đóng cửa sổ trong lúc chờ xác nhận nhưng thông tin yêu cầu vẫn giữ và có nút mở lại.

## Cài đặt
1. Trên Supabase production, chạy toàn bộ supabase/migrations/028_employee_management.sql một lần.
2. Báo Success hoặc lỗi. Không chạy lại 017–027.
3. Sau database thành công, phát hành các file frontend EmployeeEditor.tsx, EmployeeManagement.tsx, OperationsPanel.tsx và style.css qua GitHub main/Vercel. Không thay .env hoặc backend staff-admin của 027.

Nếu bước SQL có lỗi, transaction chưa commit; chạy ROLLBACK nếu SQL Editor giữ trạng thái lỗi và gửi thông báo, không bỏ phần kiểm tra.

## Kiểm tra tự động
PGlite/Auth giả lập: chỉ Owner; chặn tự nâng quyền/Owner/vai trò cũ; chỉnh sửa, khóa và mở; JWT cũ mất quyền gọi món/thanh toán; đổi vai trò Kitchen/Waiter; request replay một kết quả; stale version không ghi đè; mã trùng; giữ cờ đổi mật khẩu, hóa đơn cũ; rollback thu hồi RPC.
Chromium/API giả lập: sửa/khóa/mở, Owner không có nút Sửa, mất phản hồi rồi tải lại dùng đúng request cũ, lỗi phiên bản rõ, mobile không tràn. Hồi quy danh sách/tạo tài khoản/Kitchen. TypeScript/Vite build.
Không coi mock/PGlite là kiểm thử kết nối đồng thời với Supabase thật. Không chạy đơn hoặc thanh toán giả trên production.

## Quay lại
Khôi phục frontend trước 028 và chạy supabase/rollbacks/028_employee_management.sql để thu hồi EXECUTE update_employee. Giữ staff_version, trigger, ledger và audit: không mất cập nhật đã lưu và không tái mở quyền tài khoản đã khóa. list_employees vẫn tương thích giao diện trước 028 vì chỉ thêm staff_version. Không tự gỡ các bảo vệ 017–027. Nếu muốn bật RPC lại, dùng GRANT nêu trong file rollback, không chạy lại toàn bộ 028.

Còn phần đặt lại mật khẩu an toàn trước khi chuyển sang phần cài app ra màn hình chính.
