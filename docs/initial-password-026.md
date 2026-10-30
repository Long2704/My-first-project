# Bước 026 — Bắt buộc đổi mật khẩu tạm

Chỉ áp dụng trên project thử nghiệm, sau 025. Chưa tạo tài khoản trong bước này, chưa deploy Edge Function mới, không thay production.

## Mục tiêu
Owner sẽ đặt mật khẩu tạm khi tạo nhân viên. Nhân viên phải đổi mật khẩu riêng trước khi được dùng POS. Cờ profiles.must_change_password chặn quyền ở database, không chỉ ẩn giao diện.

Tài khoản hiện có mặc định false, không bị đổi quyền hoặc mật khẩu. Owner không được đưa vào trạng thái mật khẩu tạm này. Không sửa đơn hàng, hóa đơn hay dữ liệu thanh toán.

## Thực hiện từng phần
1. Lưu 026_initial_password_gate.sql vào supabase/migrations cùng các file trước.
2. Mở SQL Editor của project thử nghiệm; chạy toàn bộ file một lần. Không chạy lại 017–025.
3. Dừng để kiểm tra kết quả trước khi cập nhật giao diện. Chưa tự đánh dấu tài khoản nào must_change_password=true.
4. Sau khi SQL thành công: sao lưu src/main.tsx và src/style.css; thêm src/InitialPasswordSetup.tsx, thay main.tsx và style.css bằng bản đi kèm. Giữ .env.local của project thử nghiệm.
5. Chạy npm.cmd run build, sau đó npm.cmd run dev. Đăng nhập Owner, kiểm tra phục vụ/bếp/quản lý vẫn mở được.
6. Kiểm thử Auth thật với tài khoản thử nghiệm riêng sẽ hướng dẫn sau, không áp dụng cho Owner hoặc tài khoản đang phục vụ khách.

## Cách hoạt động
get_my_access trả thêm must_change_password. Khi true, current_staff_role trả null và has_permission trả false; ứng dụng không tải dữ liệu POS và chỉ mở form đổi mật khẩu.

Form dùng Supabase Auth updateUser để đổi mật khẩu của chính người đang đăng nhập. Không cập nhật cờ profiles từ frontend. Trigger trên auth.users chỉ bỏ cờ khi Auth thực sự thay đổi hash mật khẩu; thay metadata hoặc giữ nguyên/rỗng hash không mở quyền. Tài khoản bị khóa vẫn bị khóa sau khi đổi mật khẩu.

Form yêu cầu tối thiểu 12 ký tự; chính sách mật khẩu phía server vẫn do Supabase Auth thực thi. Không lưu mật khẩu trong localStorage/sessionStorage hay log. Khi chưa rõ kết quả do lỗi mạng, nút Kiểm tra lại chỉ đọc quyền, không gửi mật khẩu lần hai.

## Phần tiếp theo
Backend tạo tài khoản cần Owner đang hoạt động có employees.manage, dùng Admin API phía server, chỉ cho Waiter/Kitchen, và tạo profile với must_change_password=true. Không nhận role Owner hoặc trạng thái tự mở quyền từ frontend. Chưa triển khai action tạo tài khoản trong bước 026.

Lưu ý cho chức năng đặt lại mật khẩu tương lai: admin đổi hash cũng kích hoạt trigger. Luồng reset phải khóa thao tác, đổi mật khẩu rồi đặt lại cờ true trước khi mở lại tài khoản; không tái sử dụng thiếu bước này. Khôi phục tài khoản đã tồn tại không được tự đặt lại mật khẩu khi retry tạo tài khoản.

## Kiểm thử đã chạy
PGlite với Auth giả lập: chặn RPC và đọc đơn trước đổi; chặn sửa profile trực tiếp; metadata/hash rỗng/hash giữ nguyên không mở quyền; đổi hash mở đúng Waiter/Kitchen; tài khoản khóa vẫn khóa; Owner và dữ liệu cũ giữ nguyên; rollback bị chặn khi còn pending và giữ hóa đơn.
Chromium với API giả lập: form bắt buộc, tải lại vẫn chặn, nhập khớp, Auth từ chối, thành công, mất phản hồi kiểm tra lại không gửi hai lần, không lưu mật khẩu trong storage.
Kiểm thử staff-admin xác thực JWT và quyền với fetch giả lập; build TypeScript/Vite. Đây không thay thế kiểm thử Auth/trigger trên project Supabase thử nghiệm thật.

## Quay lại
Dùng supabase/rollbacks/026_initial_password_gate.sql chỉ trên project thử nghiệm, đồng thời khôi phục các file frontend đã sao lưu. Rollback tự từ chối nếu còn tài khoản chưa đổi mật khẩu. Không xóa cờ để vượt kiểm tra; cần hoàn tất đổi mật khẩu trước. Không dùng CASCADE hoặc xóa dữ liệu.
