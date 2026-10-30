# 029 — Tên đăng nhập thay email/mã nhân viên trên giao diện

## Hành vi
Giao diện đăng nhập chỉ hỏi tên đăng nhập và mật khẩu. Thêm nhân viên chỉ hỏi tên, tên đăng nhập, vai trò và mật khẩu tạm. Danh sách và cửa sổ sửa dùng tên đăng nhập, không hiện mã hoặc email. Owner hiện tại (nếu chỉ có một Owner) có tên `owner`, giữ mật khẩu hiện có. Nhân viên cũ dùng mã cũ viết thường nếu hợp lệ; nếu không có mã, được tạo tên nv_<UUID>. Owner có thể đổi username của Waiter/Kitchen trong Sửa.

Không đổi UUID/email/hash trong auth.users của tài khoản hiện có, không xóa staff_code hay lịch sử. Username nằm ở profiles và được ánh xạ đến email Auth chỉ bên server. Đổi username không cần đổi email/mật khẩu. Tên 3–40 ký tự, chữ không dấu/số/chấm/gạch ngang/gạch dưới, không phân biệt hoa thường. Không tự nâng quyền hoặc sửa Owner. Tên đã được giữ trong yêu cầu tạo chưa hoàn tất hoặc lịch sử yêu cầu của tài khoản khác không được dùng lại.

## Backend
staff-login là endpoint công khai dùng trước đăng nhập: **Verify JWT OFF chỉ cho function này**. Nó gọi resolver bằng service_role phía server, sau đó gửi mật khẩu đến Supabase Auth để xác thực. Resolver chỉ EXECUTE bởi service_role, không cho anon/authenticated đọc email. Trả duy nhất access_token/refresh_token khi Auth chấp nhận; frontend dùng auth.setSession chuẩn của Supabase, không tạo cơ chế session riêng. Không lưu/log mật khẩu. Lỗi sai tên/sai mật khẩu chung, không trả email nội bộ.

Resolver giới hạn 10 lần/tên/phút và 100 lần chung/phút, dọn bucket cũ để hạn chế lưu trữ do tên ngẫu nhiên. Đây là giới hạn bổ sung; Auth vẫn áp dụng chính sách và rate limit riêng, không tuyên bố thay thế Auth. Có thể gây chờ một phút nếu thử quá nhiều hoặc bị tấn công; không thay giới hạn mà chưa xét quy mô quán.

staff-admin vẫn cần JWT và kiểm tra Owner như trước. Nó chấp nhận username, dùng request UUID để tạo email kỹ thuật tại staff.pos.invalid và mã nội bộ; không gửi thư mời hoặc email. Email này chỉ phục vụ Auth, không trình bày trên UI và không dùng quy trình email reset. Mật khẩu tạm và yêu cầu đổi lần đầu giữ nguyên.

Giữ đường đăng nhập email cũ bên trong frontend để Owner vẫn truy cập được trong giai đoạn chuyển đổi, không có trường email riêng. Các yêu cầu tạo/sửa đang chờ từ 027/028 vẫn dùng payload và RPC cũ đến khi xác nhận, không xóa hoặc tạo lại.

## Thứ tự cài đặt production
1. Chạy supabase/migrations/029_username_accounts.sql một lần (sau 028). Giữ bản backup hiện hành; migration dùng transaction và không cập nhật Auth user/hóa đơn. Chưa thay giao diện lúc này.
2. Tạo Edge Function `staff-login`, dán index.ts đi kèm. Tắt Verify JWT riêng `staff-login`, vì đây là điểm xác thực mật khẩu trước khi có phiên; không tắt xác thực của staff-admin vì bước này.
3. Cập nhật function `staff-admin` bằng bản 029. Không điền key vào code, không thêm service key vào VITE_* hoặc chat. Supabase tự cung cấp biến server mặc định.
4. Sau khi hai function deploy xong, phát hành frontend qua main/Vercel. Không thay .env production hoặc copy .env staging.
5. Tên Owner hiện tại là owner, cùng mật khẩu đang dùng. Không yêu cầu người dùng lặp các ca kiểm thử thủ công; báo lỗi vận hành nếu có.

## Kiểm tra tự động
PGlite/Auth giả lập: giữ Auth và hồ sơ cũ; tên Owner và mã cũ; resolver không public; rate limit; tạo tài khoản username atomic; đổi username không đổi Auth email/id; khóa không resolve; replay; giữ hóa đơn.
Native fetch giả lập: service key chỉ dùng resolver server; Auth xác minh mật khẩu; lỗi tên/sai mật khẩu chung; không lộ email/key/password; old/new staff-admin.
Chromium/API giả lập: đăng nhập owner và thông báo rate limit, session chuẩn, form bỏ email/mã; tạo/sửa/danh sách nhân viên; hồi quy gọi món/thanh toán/đổi mật khẩu và Kitchen. Build TS/Vite.
Chưa chạy Auth thật cho endpoint mới hoặc hai kết nối database đồng thời.

## Quay lại an toàn
Rollback 029 chỉ thu hồi quyền tạo/sửa RPC mới, giữ username, ledger, resolver và staff-login để người đã có tài khoản username tiếp tục đăng nhập. Không xóa cột username/email kỹ thuật hay tài khoản. Không quay toàn bộ frontend về bản chỉ chấp nhận email nếu đã tạo nhân viên username, vì họ không có email để nhập; cần giữ màn hình đăng nhập mới và sửa riêng phần lỗi. Đường email cũ vẫn hỗ trợ tài khoản cũ khi cần khôi phục.

Sau đợt này vẫn còn quy trình đặt lại mật khẩu Owner cấp tạm; không gửi email khôi phục tới địa chỉ kỹ thuật.
