# 032 — Xóa tài khoản và mật khẩu mới 6–12 ký tự

## Hành vi
Owner có nút Xóa cho Waiter/Kitchen và phải xác nhận. Không xóa Owner. Backend dùng Auth Admin DELETE với should_soft_delete=true; Supabase xóa khả năng đăng nhập và làm mờ thông tin Auth, giữ UUID. Hồ sơ public không bị xóa để các khóa ngoại và lịch sử thanh toán/đơn/audit còn nguyên. Nhân viên bị ẩn khỏi danh sách thường, không thể mở lại bằng Sửa/Mở khóa. Tên đăng nhập được giữ cho lịch sử, không tái sử dụng cho tài khoản khác.

Password mới 6–12 ký tự ở tạo nhân viên, đặt lại mật khẩu và đổi lần đầu. Đăng nhập vẫn nhận mật khẩu dài của tài khoản cũ. Không thay password/hash hiện tại. Supabase Auth có minimum tối thiểu 6 trong mã nguồn; không hỗ trợ 4–5 với cơ chế này. Chính sách server hiện hành vẫn được Auth thực thi; nếu project đặt minimum >6 hoặc yêu cầu độ mạnh khác, cần chỉnh trong cấu hình Auth để nhận password 6 ký tự, không tự thay qua frontend.
Nguồn kiểm tra: https://github.com/supabase/auth/blob/master/internal/conf/configuration.go (defaultMinPasswordLength=6, config dưới mức này bị nâng lên 6).
Soft-delete: https://github.com/supabase/auth/blob/master/internal/models/user.go (SoftDeleteUser giữ ID, làm mờ email/phone, xóa hash và logout).

## Trình tự
begin_employee_deletion gọi bằng Owner JWT: kiểm tra quyền, khóa hàng, expected staff_version, cấm xóa trong khi reset password, lưu request UUID. Đặt is_active=false, pending=true, thu hồi phiên. Native Auth soft-delete chỉ được gọi ở backend với service key và confirmed=true. finish chỉ service_role được gọi, và tự kiểm chứng auth.users.deleted_at trước khi đóng request/ẩn nhân viên/audit. Auth lỗi hoặc mất phản hồi giữ chặn tài khoản; Kiểm tra lại có thể tự hoàn tất nếu Auth đã soft-delete, không cần DELETE lần hai.

Guard ngăn mở lại/đổi quyền/username/reset tài khoản pending hoặc đã xóa. Auth trigger reset cũng chặn nonce đến chậm trên tài khoản đã xóa. FK ledger employee_id ngăn một hard-delete ngoài ý muốn cascade xóa profile. Không gửi hard-delete hoặc bỏ qua FK. Không xóa hóa đơn, order, audit hay lịch sử nhân viên.

## Cài production
1. Chạy supabase/migrations/032_employee_deletion.sql một lần sau031. Migration không tự xóa hay đổi password của tài khoản nào.
2. Deploy staff-admin index.ts bản032; giữ cấu hình xác thực và biến server. staff-login không đổi.
3. Phát hành frontend qua main/Vercel sau database/backend thành công. Không đổi .env production.
4. Nếu mật khẩu 6 ký tự vẫn bị Auth từ chối do chính sách project: kiểm tra Authentication > cấu hình bảo mật mật khẩu > minimum length=6. Không tắt xác thực hoặc public signup, không gửi password/key vào chat.

## Kiểm thử
PGlite/Auth giả lập: Owner-only, cấm Owner, pending khóa phiên, hoàn tất kiểm chứng deleted_at, FK chặn hard-delete, ẩn danh sách, cấm mở lại, idempotency/audit một lần và giữ Auth UUID/profile/hóa đơn. Fetch giả lập kiểm chứng body chỉ should_soft_delete=true, cần confirmed, actor không lấy từ frontend, lost response status không DELETE lần hai. Chromium/API giả lập kiểm chứng popup trước hành động, Owner không có nút, hồi phục reload, giới hạn password min6/max12 và đăng nhập cũ dài. Hồi quy reset/tạo/đổi lần đầu/sửa nhân viên. Build TS/Vite. Không coi mock là kiểm thử GoTrue thật.

## Rollback
Khôi phục giao diện phần xóa nếu cần. Backend giữ để xử lý hết pending. rollback032 chỉ tắt bắt đầu yêu cầu mới và từ chối khi còn pending. Không tự khôi phục Auth soft-deleted (không đảo ngược), không xóa ledger/guard/profile, không bỏ bảo vệ JWT. Không giảm/xóa dữ liệu thanh toán để vượt FK. Đổi lại giới hạn password chỉ thay UI/backend; tài khoản cũ 6–12 vẫn cần đăng nhập được.
