# 033 — Phục vụ/Bếp hủy cả bàn chưa thanh toán

Theo yêu cầu Owner, bổ sung quyền riêng `tables.cancel` cho `chu`, `phuc_vu`, `bep`. Bếp có quyền này theo quy tắc kế thừa chức năng Phục vụ. Không cấp `orders.cancel` cho staff: hủy từng món vẫn Owner như trước; không cấp giảm giá, hoàn tiền, báo cáo hay xóa lịch sử.

## Phát hành

1. Frontend mới tương thích với SQL cũ: Owner dùng quyền cũ; Phục vụ/Bếp chỉ thấy nút sau khi database trả quyền mới. Bản frontend không tự cấp quyền theo tên vai trò.
2. Trong SQL Editor project production đúng quán, chạy nguyên tệp `supabase/migrations/033_staff_table_cancellation.sql` một lần. Tệp có transaction begin/commit, chỉ thay 3 hàm phân quyền/RPC và ACL; không đổi dữ liệu tài khoản, món, đơn hoặc hóa đơn.
3. Mở POS online, nhận bản cập nhật sau khi hoàn tất thao tác chờ và đóng mọi cửa sổ cũ. Đăng nhập Phục vụ → chọn bàn có món chưa trả → nút ⋯ góc trên → Hủy cả [tên bàn] → xác nhận danh sách. Nút ⋯ có cả ở màn đơn và danh sách gọi thêm.
4. Cơ chế đồng bộ quyền hiện tại đọc lại mỗi 5 giây. Không yêu cầu cấp key, thay cấu hình Auth hoặc deploy Edge Function.

## Backend

`has_permission` giữ nguyên active/must_change_password/staff_session_current. `get_my_access` thêm quyền mới vào danh sách trả về. `cancel_table_session` kiểm tra `has_permission('tables.cancel')` trước mọi trường hợp, kể cả replay request đã hoàn tất. Không chỉ dựa vào nút ẩn/hiện.

Giữ nguyên khóa UUID và khóa bàn/phiên/món, so khớp toàn bộ ID món chưa trả trước khi hủy; dòng đã trả không nằm trong snapshot hợp lệ. Lưu nhân viên auth.uid(), thời gian, danh sách món và audit. Mất phản hồi/reload giữ nguyên UUID; không tạo nhật ký hai lần. Bill/bill_items đã trả không bị sửa/xóa. Không tự động hủy bàn hoặc gửi giao dịch thật khi cài SQL.

## Kiểm tra

- `npm run test:staff-table-cancel`: PGlite dựng schema 003–032 và giả Auth; 033 không làm đổi dữ liệu cũ; Owner/Waiter/Kitchen được phép; anon, cashier cũ, người thiếu hồ sơ, tài khoản khóa, phải đổi mật khẩu, phiên bị thu hồi bị chặn. Không cấp quyền hủy từng món/tài chính. Kiểm tra snapshot gồm món đã trả bị từ chối, chỉ hủy phần chưa trả, giữ bill/items, lưu actor/audit một lần, replay/chuyển actor/khác payload bị chặn; rollback giữ lịch sử.
- `npm run test:staff-table-cancel-ui`: 3 vai trò, ⋯ trong menu gọi thêm, popup/thoát chưa gọi RPC, loại món đã trả, snapshot thay đổi, lỗi mất phản hồi, reload giữ UUID, Bếp chuyển về Phục vụ để kiểm tra yêu cầu đang chờ.
- Table actions/POS reference suites và TypeScript/Vite build. Giao dịch và Auth trong test đều giả; không hủy đơn thật. Khóa chống xung đột giữ nguyên từ RPC cũ; không khẳng định đã kiểm thử concurrent nhiều kết nối production.

## Rollback

Chạy `supabase/rollbacks/033_staff_table_cancellation.sql`: phục hồi đúng helper/RPC trước 033, giữ toàn bộ ledger/audit/đơn/bill phát sinh. Phục vụ/Bếp mất quyền mới khi đồng bộ; Owner tiếp tục theo quyền cũ. Frontend mới vẫn chạy với rollback này. Không chạy lại migration cũ có DDL tạo bảng, không xóa table_cancellations và không xóa localStorage còn thao tác chờ.
