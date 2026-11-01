# Phiếu ảnh tạm và đặt lại dữ liệu thử trước vận hành

Người dùng xác nhận toàn bộ đơn và ảnh hiện tại đều là dữ liệu thử, đồng thời yêu cầu xóa ảnh sau hoàn thành, không lưu lịch sử/SQL. Đây thay thế quy tắc lưu lịch sử ảnh của 034. Đơn bán hàng thông thường vẫn có lịch sử và hóa đơn như trước.

## Hành vi ảnh mới

- Khi chờ, mỗi ảnh có bản ghi tạm và hai file private (ảnh/preview) để đồng bộ các thiết bị.
- Vuốt hoặc Xong gọi `begin_kitchen_image_completion`, mở quyền xóa đúng đường dẫn ảnh/preview của phiếu và các lượt tải lại thuộc cùng request đang xử lý cho Owner/Kitchen có `kitchen.complete` và `kitchen_images.read`.
- Trình duyệt xóa file qua Storage API có JWT; không có service key trong frontend và không xóa `storage.objects` bằng SQL. Policy restrictive vẫn bảo vệ bucket trước broad policy cũ.
- `complete_kitchen_image_ticket` kiểm tra quyền hiện tại và file metadata đã thật sự biến mất, rồi xóa phiếu và toàn bộ lượt tải của cùng request trong cùng transaction. Nếu file chưa xóa hết hoặc mất mạng, phiếu vẫn ở Đang làm để thử lại. Hai thiết bị cùng hoàn thành nhận kết quả `purged: true` nhất quán.
- Không tạo bản ghi done, không truy vấn/hiển thị ảnh trong Lịch sử; xóa Blob URL khỏi cache khi phiếu biến mất. Lịch sử đơn thường không đổi.
- Không giữ tombstone/history theo từng ảnh. Chỉ có một dòng `pos_runtime_settings` với generation số cố định để request cũ không tạo lại ảnh đã xóa. UUID mới lấy prefix generation qua RPC Owner-only; request đang được theo dõi vẫn có thể tiếp tục nếu generation đổi bởi ảnh khác. Request cũ/không còn được theo dõi nhận `expired`, không tự gửi lại bằng UUID mới; người dùng chọn ảnh lại nếu muốn tạo phiếu mới.
- Khi hoàn thành, dọn cả file/bản ghi các lượt tải lại của cùng request. Các request thất bại chưa từng tạo được phiếu vẫn dùng cơ chế cleanup ảnh mồ côi; không phải lịch sử phiếu đã hoàn thành.

## Trình tự áp dụng — chưa chạy trên project thật

1. Trước vận hành, đóng các thao tác đang nhập/gửi. Trong SQL Editor của đúng project `uiwzinyckukaqlbznnam`, chạy migration **035_temporary_kitchen_images.sql** một lần. Nó kiểm tra grants DELETE/SELECT Storage và bucket private; không tự mở grant toàn bucket khác nếu preflight không đạt. Không xóa dữ liệu bán hàng trong migration.
2. Cập nhật `supabase/functions/kitchen-image-upload/handler.ts`, deploy lại riêng `kitchen-image-upload --project-ref uiwzinyckukaqlbznnam --use-api`. Gói JS 0,71 MiB/loader WASM đã kiểm hash giữ theo bản trước; thay đổi Edge chỉ thêm phản hồi request expired, không thêm service key phía client.
3. Sau khi backend được áp dụng, merge frontend và chờ production deploy thành công. Hoàn tất thao tác, đóng mọi tab/PWA cũ trên tất cả thiết bị rồi mở lại. Client cũ không thể tự bỏ qua hai bước xóa file/SQL.
4. Chỉ sau khi sẵn sàng đặt lại: chạy **releases/035_trial_data_backup.sql** (chỉ đọc), xuất toàn bộ kết quả CSV/JSON và lưu trên máy. Đây là backup các bản ghi/manifest cho bộ dữ liệu thử nhỏ, không phải bản backup schema/Auth toàn hệ thống; không gồm byte file ảnh. Tải riêng ảnh thử muốn giữ bằng Storage Dashboard trước khi dọn.
5. Tạm ngừng dùng POS ở mọi thiết bị. Trong Storage, **làm trống nội dung** bucket `kitchen-ticket-images` bằng Dashboard/API. Giữ nguyên bucket Private, không Delete bucket và không DELETE bảng storage.objects.
6. Chạy riêng **releases/035_reset_trial_data.sql**. Đây là script phá hủy một lần, không phải migration hoặc API của app. Không đưa vào chuỗi db push tự động.
7. Xác nhận orders/bills/sessions/image_tickets đều 0. Mở lại bản app mới trên từng thiết bị; `data_epoch` tăng giúp bỏ mã đơn/thanh toán/chuyển/hủy/tách bill/ảnh THỬ đang chờ của chính tài khoản. Không xóa Auth, mật khẩu, config hoặc tác vụ người dùng khác khi chưa đăng nhập tài khoản đó.

## Phạm vi reset

Xóa đúng các bảng giao dịch thử: orders, order_items, table_sessions, bills, bill_items, bill_orders, table_transfers, bill_moves, table_cancellations, takeaway_requests và hai bảng ảnh. Xóa audit liên kết session/bill thử; giữ audit cấu hình/nhân sự không liên kết giao dịch.

Giữ Auth users, profiles/Owner/nhân viên, quản lý nhân viên, menu/giá, bàn/thứ tự bàn, quyền và Storage policies. Số hóa đơn bắt đầu lại 1; UUID vẫn tạo mới như bình thường.

Script có cutoff xác nhận `2026-11-01 16:17:28 UTC`, kiểm tra bucket đã trống và cờ chỉ chạy một lần. Có dữ liệu mới sau cutoff thì dừng; không sửa mốc để bỏ qua khi chưa kiểm tra lại. Không dùng CASCADE: FK ngoài phạm vi làm toàn transaction thất bại thay vì xóa lan. Không có endpoint reset cho người dùng app.

DELETE không đảm bảo dung lượng file PostgreSQL giảm ngay; vùng trống có thể được tái sử dụng. Xóa byte ảnh qua Storage mới giảm phần ảnh còn lưu; băng thông đã dùng và phí gói cố định không được hoàn lại.

## Kiểm thử đã chuẩn bị/chạy

- Build TypeScript/Vite/PWA; bộ test SQL 035 về quyền, partial file deletion, retry, purge SQL, không sống lại request cũ và một dòng generation.
- Hai kết nối PostgreSQL 17 cùng purge: cả hai thành công, chỉ xoay generation một lần và không còn ticket/upload row. Storage/Auth dùng fixture schema.
- UI API giả: thứ tự thời gian/nút gọn/auto-upload còn đúng; lỗi xóa Storage, lỗi SQL ACK giữ phiếu; sau purge không có ảnh trong history/reload/login; request expired không tạo phiếu; data_epoch bỏ các tác vụ thử cũ; offline và cache.
- Fixture nghiệp vụ 001–035: xuất backup, reset từ chối dữ liệu mới/bucket chưa trống/chạy lần hai, giữ nguyên accounts/config, hóa đơn mới số 1; tác động phá hủy của bài test được rollback.
- Hồi quy chuông Bếp, Kitchen/phục vụ, thanh toán. Không chạy kiểm thử ghi dữ liệu trên production.

## Rollback

`supabase/rollbacks/035_temporary_kitchen_images.sql` chỉ tắt quyền xóa mới/khôi phục logic ảnh 034; giữ runtime settings/data_epoch và cột mới. Cần phối hợp frontend rollback, không chạy riêng trong giờ phục vụ. Không thể khôi phục byte ảnh/bản ghi đã purge hoặc đơn thử đã reset bằng rollback schema. Muốn phục hồi phải dùng backup đã tải trước; không lấy backup cũ đè giao dịch bán thật mới. Không có script khôi phục tự động và chưa reset production trong phiên này.
