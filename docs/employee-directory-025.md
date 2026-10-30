# Bước 025 — Owner xem danh sách nhân viên

## Phạm vi

Chỉ xem tên, mã, vai trò, trạng thái và ngày tạo hồ sơ POS. Tìm theo tên/mã,
lọc vai trò/trạng thái, phân trang 20 người. Không có tạo, sửa, khóa/mở khóa,
đổi vai trò hoặc đặt lại mật khẩu trong bước này.

Owner hiện chưa có mã vẫn được hiển thị Chưa có mã. Nếu có hồ sơ thu_ngan cũ,
Owner thấy nhãn Thu ngân (cũ) để nhận biết; không tự đổi hoặc xóa dữ liệu đó.
Các lựa chọn lọc vai trò chỉ có Owner, Waiter, Kitchen.

## Phân quyền và dữ liệu

`list_employees(text,text,boolean,integer,integer)` chỉ cho Owner đang hoạt động
và có quyền employees.manage. Quyền lấy từ profiles/auth.uid(), không nhận mã
người gọi hoặc role do frontend khai báo. Ẩn danh không được gọi; Waiter/Kitchen,
vai trò cũ, người thiếu hồ sơ và Owner bị khóa bị từ chối ngay trên backend.
RLS và các quyền ghi trực tiếp hiện có không thay đổi.

Hàm chỉ đọc sáu cột profiles (id dùng nội bộ), không truy vấn auth.users, email,
mật khẩu, token hoặc service_role. Đây là danh sách hồ sơ POS, không phải danh
sách các tài khoản Auth chưa có hồ sơ. Migration không tạo/sửa/xóa tài khoản,
đơn, hóa đơn hoặc nhật ký. Tìm kiếm là chuỗi literal, có giới hạn 100 ký tự.

## Tốc độ và giao diện

- Màn hình nhân viên tải bằng React.lazy khi Owner mở, không tải module khi gọi món.
- Một RPC cho một trang dữ liệu và tổng số dòng trên cùng snapshot; tối đa 100
  dòng/request ở backend, mặc định UI 20. Không tải lại toàn danh sách mỗi 5 giây.
- Bấm Tìm để áp dụng bộ lọc; Tải lại dùng bộ lọc đã áp dụng.
- Hủy request khi rời trang/đổi bộ lọc; kết quả lỗi hoặc response cũ không ghi đè dữ liệu mới; Owner mất quyền sẽ bị
  đưa khỏi màn hình theo cơ chế đồng bộ quyền hiện có.
- Màn hình chỉ xem, không đưa nút tạo/sửa chưa hoạt động vào giao diện.

## Áp dụng trên bản thử nghiệm Windows

1. Sao lưu thư mục mã nguồn hiện đang chạy (đã có 024).
2. Lưu SQL vào supabase/migrations/025_employee_directory.sql và chạy toàn bộ file
   một lần trong SQL Editor của project thử nghiệm. Không chạy lại 017–024.
3. Tạo src/EmployeeManagement.tsx; cập nhật cùng nhau src/main.tsx, src/PosIcon.tsx,
   src/style.css. Giữ .env.local trỏ thử nghiệm. Không thêm thư viện hoặc sửa Vercel.
4. npm.cmd run build, rồi npm.cmd run dev (hoặc tải lại dev server đang chạy).
5. Owner mở Quản lý → Quản lý nhân viên, xem các hồ sơ thử hiện có; tìm TEST-W01,
   lọc Kitchen/Đang hoạt động, dùng Tải lại. Danh sách nhỏ hơn 21 người không hiện
   phân trang, không cần tạo thêm tài khoản chỉ để thử phân trang.
6. Waiter/Kitchen không có mục nhân viên. Không dùng SQL Editor để thử quyền
   người đăng nhập vì SQL Editor không chạy dưới JWT trong app.

## Kiểm thử đã chuẩn bị

- tests/employee-directory-sql.mjs: PGlite + Auth giả lập, 45 hồ sơ, ba trang,
  lọc/tìm, ký tự %/_ literal, đối số sai, chỉ sáu cột, chặn gọi API trái quyền/
  giả claim role/Owner bị khóa trên phiên cũ. Snapshot hồ sơ/Auth/đơn/hóa đơn/audit
  giữ nguyên khi đọc, áp dụng, rollback và áp dụng lại.
- tests/employee-directory-flow.mjs: Playwright + API giả lập, Owner mở/tìm/lọc/
  phân trang, ngày VN, mã trống, role cũ, React escape tên, lỗi/thiếu SQL,
  không quyền, response cũ, Owner bị khóa, Waiter/Kitchen không thấy mục.
- Kiểm thử hồi quy gọi món, thanh toán, Kitchen và bố cục, cùng build TypeScript/Vite.

Không có kết nối tới Supabase thật của người dùng trong môi trường lập trình.
Các kết quả trên không thay thế kiểm chứng trên project thử nghiệm sau áp dụng.
Ảnh minh họa dùng dữ liệu giả; không khóa tài khoản Kitchen thực tế.

## Quay lại

Dừng app mới và khôi phục main.tsx, PosIcon.tsx, style.css từ bản sao trước 025;
gỡ file EmployeeManagement.tsx nếu cần. Chạy SQL trong
supabase/rollbacks/025_employee_directory.sql trên project thử nghiệm để gỡ riêng
hàm đọc. Không gỡ các migration 017–024 hoặc xóa bảng. Không mất tài khoản,
đơn, hóa đơn hoặc nhật ký. Chưa đẩy GitHub và chưa deploy production.
