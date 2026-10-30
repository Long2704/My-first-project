# 030 — Owner đặt lại mật khẩu nhân viên

## Hành vi
Trong Quản lý nhân viên, Waiter/Kitchen có nút Đặt lại mật khẩu. Owner nhập mật khẩu tạm 12–128 ký tự và xác nhận. Không áp dụng Owner. Không gửi email khôi phục tới email kỹ thuật. Không lưu/log/hiển thị lại mật khẩu tạm. Nhân viên phải đăng nhập lại và đặt mật khẩu riêng trước khi gọi món/thanh toán/bếp. Nhân viên vốn đã khóa vẫn giữ trạng thái khóa.

## Trình tự an toàn
- begin_employee_password_reset kiểm tra Owner đang hoạt động, quyền hiện tại và staff_version; khóa hàng, lưu request UUID/target/trạng thái cũ, đặt pending, chặn thao tác và xóa phiên Auth của đúng nhân viên. Không xóa Auth user hoặc giao dịch. Mỗi nhân viên có tối đa một reset đang chờ.
- Edge staff-admin xác thực JWT như trước. Backend đăng ký nonce lần thử bằng service-only RPC; lấy app_metadata hiện có rồi gửi Auth Admin PUT với password và nonce đáng tin cậy. Không nhận owner_id/app_metadata từ frontend, không tự ghi hash.
- Trigger Auth nhận nonce do server cấp, buộc đổi mật khẩu và thu hồi session. Dùng txid để nhận diện một lần Auth Admin update dù hash và metadata được ghi ở các UPDATE khác thứ tự trong cùng transaction. Lần Admin đến chậm vẫn không bị coi là nhân viên tự đổi mật khẩu, kể cả request đã được xác nhận trước đó. Marker không hợp lệ hoặc mục tiêu đã là Owner sẽ làm transaction Auth thất bại.
- Chỉ service_role được finish sau khi Auth Admin báo thành công. Database lại thu hồi phiên, giữ cờ đổi mật khẩu và phục hồi trạng thái hoạt động trước reset. Chưa xác nhận được thì tài khoản vẫn bị chặn.
- staff_session_current kiểm tra JWT session_id với auth.sessions và mốc thu hồi. JWT cũ không lấy lại được quyền khi tài khoản mở lại hay nhân viên đã đổi mật khẩu. Session mới được tạo sau mốc thì được dùng. Tài khoản chưa từng reset có mốc NULL, giữ nguyên cách truy cập hiện tại.

Frontend chỉ giữ request/target/version/tên trong localStorage theo Owner UUID. Mất phản hồi thì kiểm tra lại: nếu hoàn tất, không đổi mật khẩu lần hai; nếu còn pending, nhập mật khẩu tạm khác rồi tiếp tục cùng request. Không bỏ pending để mở khóa khi chưa rõ kết quả. Có thể tiếp tục yêu cầu bằng Owner khác qua status của đúng nhân viên; không tạo thêm reset song song.

## Cài production
1. Chạy supabase/migrations/030_employee_password_reset.sql một lần sau 029. Migration chỉ thêm schema/functions/triggers; không tự reset hoặc xóa session của ai khi chạy.
2. Cập nhật Edge Function staff-admin bằng index.ts của 030, giữ cấu hình xác thực hiện tại. staff-login không cần đổi. Không nhập key vào code; dùng biến server mặc định.
3. Sau backend deploy, phát hành EmployeePasswordReset.tsx, EmployeeManagement.tsx, EmployeeEditor.tsx, OperationsPanel.tsx và main.tsx qua main/Vercel. Không đổi .env.

Không yêu cầu người dùng lặp ca kiểm thử thủ công. Nếu có lỗi cài đặt, gửi nguyên lỗi trước khi chạy lại hoặc bỏ qua câu SQL. Giao diện cũ vẫn chạy khi mới cập nhật schema.

## Kiểm thử tự động
- PGlite/Auth giả lập: migration không đổi Auth user; chỉ Owner, bảo vệ Owner; pending khóa/mở; truy cập trực tiếp RPC hoàn tất bị chặn; replay/conflict; giữ trạng thái khóa/hóa đơn; JWT cũ không có quyền sau reset và đổi mật khẩu, phiên mới có quyền; Auth đến muộn bắt đổi và thu hồi phiên; khác thứ tự hash/metadata cùng transaction.
- Native fetch giả lập: giữ metadata Auth, nonce server, service-key đúng endpoint, không tin owner_id frontend, Auth lỗi/mất phản hồi không mở tài khoản, đã hoàn tất không reset lại; không lộ mật khẩu/key.
- Chromium/API giả lập: xác nhận, mật khẩu không vào storage, reload phục hồi, kiểm tra hoàn tất không gọi reset hai lần, pending khóa sửa, đổi mật khẩu tạm khác khi retry. Hồi quy tạo/sửa nhân viên, username và Kitchen. Build TypeScript/Vite.
Chưa kiểm thử GoTrue/Supabase thật hoặc hai kết nối DB thực. Phần trigger dựa vào transaction của Auth Admin API và schema chuẩn auth.sessions(id,user_id,created_at). Không tuyên bố mock là bằng chứng runtime production.

## Quay lại
Khôi phục riêng giao diện reset nếu có lỗi. Giữ backend để xử lý hết pending. rollback030 từ chối khi còn pending; sau đó chỉ thu hồi quyền nhận reset mới, không xóa hồ sơ/ledger/nonce hoặc bỏ bảo vệ session/mật khẩu. Không khôi phục session đã thu hồi. Không tự gỡ trigger/helper vì sẽ mở lại JWT cũ hoặc phá cờ mật khẩu. Khôi phục giao diện cũ vẫn đăng nhập lại bằng username được; reset xong chưa đổi mật khẩu vẫn phải đổi qua 026.

## Mốc giao diện
Sau khi 030 được phát hành, nhắc người dùng đưa yêu cầu chỉnh giao diện trước phần hoàn thiện mobile/PWA và cài app ra màn hình chính.
