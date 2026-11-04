# iOS chọn giây, Excel theo khung giờ, dọn lịch sử hằng tuần

## Kết quả cho người dùng

- Thay input time native (iOS không cung cấp giây) bằng ba select riêng Giờ/Phút/Giây, đủ 00–23 / 00–59 / 00–59 trên mọi trình duyệt. Giữ mặc định 00:00:00 → 23:59:59, mọi mốc là giờ Việt Nam. Hai nút Hôm nay/Tháng này đặt lại trọn ngày.
- Thêm Xuất Excel theo khung giờ, file `.xlsx` thật (không đổi đuôi CSV). Giữ nút CSV cũ.
- Sáu khung: [06,09), [09,11), [11,13), [13,15), [15,17), [17,22). Ví dụ 08:59:59.999999 thuộc 06–09; 09:00:00 thuộc 09–11. Hóa đơn trước 06 hoặc từ 22 được ghi Ngoài khung để đối soát đủ tổng. Theo `paid_at`, không phải lúc gọi món.
- Workbook có 5 sheet: Theo ngày và khung; Tổng theo khung; Tổng theo ngày; Món ăn; Thông tin. Khung không phát sinh có số 0; lọc giờ riêng lấy phần giao của khoảng chọn và khung. Món gồm cả đồ uống, lấy snapshot hóa đơn.
- Báo cáo có khối Dọn lịch sử hằng tuần chỉ Owner xem/đổi. Sau cài lịch, chạy 03:00 thứ Hai giờ Việt Nam, giữ ít nhất 30 ngày gần nhất. Chạy tuần nên dữ liệu có thể giữ gần 37 ngày; phiên được bảo vệ hoặc job lỗi có thể giữ lâu hơn. Có nút Tạm dừng/Bật lại và lần chạy gần nhất.

## Phạm vi SQL

037 thay thân RPC `revenue_report_window` bổ sung slot totals trong cùng materialized snapshot, giữ toàn bộ số tổng/ngày/món và RPC ngày cũ. Không sửa thanh toán.

038 cài cấu hình, candidate query, job runner, Owner status/toggle, log 16 lần gần nhất và trigger chống phát lại đơn đã xóa. **Cài migration không tự xóa, mặc định paused**. Bật lịch là script riêng sau khi backend/frontend sẵn sàng. Không có RPC chạy dọn trực tiếp cho browser, kể cả Owner; cron chạy với quyền quản trị cố định, không nhận cutoff tùy ý. Owner chỉ bật/tạm dừng và xem số đủ điều kiện.

## Quy tắc giữ dữ liệu 30 ngày

Chỉ dọn toàn phiên đã đóng với opened/closed, thời gian tạo/hoàn thành đơn, thanh toán, hủy món và các ledger/audit liên quan đều cũ hơn 720 giờ. Không dọn phiên còn món chưa trả/chưa hủy hoặc phiếu nấu còn món chưa hủy. Phiên hủy toàn bộ và đã cũ có thể dọn.

Các phiên nối bởi chuyển/gộp bàn, bill_orders, bill_items, item.bill_id và audit liên kết được coi là nhóm: nếu bất kỳ thành viên mới/mở/chưa hoàn thành hoặc nằm ngoài batch, giữ toàn nhóm. Điều này bảo vệ hóa đơn cũ có món đã chuyển sang phiên khách khác. Mỗi lượt tối đa 10.000 phiên, phù hợp mức 300 đơn/ngày đã trao đổi.

Trong transaction: advisory lock chặn hai job dọn cùng lúc, khóa bảng bán hàng chống race với gửi/thu/chuyển, chờ khóa tối đa 3 giây rồi báo lỗi nếu đang bận. Chọn lại tập đủ điều kiện sau khóa; xóa đúng quan hệ, không CASCADE. FK ngoài dự kiến làm rollback toàn bộ. Các màn hình đọc vẫn đọc snapshot bình thường. Không reset số hóa đơn, UUID hay sequence; không xóa menu, giá, bàn, nhân viên, Auth, ảnh, audit quản trị không liên quan giao dịch.

Một UUID request của mỗi order đã dọn được giữ trong bảng khóa chống phát lại; không giữ tên món, tiền, hóa đơn hoặc ảnh. Thiết bị cũ không tạo lại đơn đã xóa khi retry mã cũ. Trigger trả lỗi rõ; frontend chỉ bỏ đúng yêu cầu/giỏ cũ sau phản hồi xác định này, không tự tạo mã mới. Không xóa toàn bộ localStorage hoặc tác vụ hiện tại của người dùng.

## Áp dụng lên project thật (chưa thực hiện trong phiên này)

1. Chạy `supabase/migrations/037_revenue_time_slots.sql` một lần sau 036. Giữ tương thích frontend cũ.
2. Chạy `supabase/migrations/038_weekly_sales_retention.sql` một lần. Mặc định disabled, chưa có lịch và chưa xóa dữ liệu.
3. Phát hành frontend qua main/Vercel sau khi backend Success; xử lý thao tác chờ rồi mở lại app để cập nhật. Không deploy Edge và không đổi .env.
4. Lần đầu muốn bật lịch: xuất/sao lưu các giao dịch cũ cần giữ ở nơi riêng, kiểm tra danh sách đủ điều kiện trong báo cáo hoặc `releases/038_retention_preview.sql`. Đây là xóa vĩnh viễn dữ liệu nghiệp vụ khỏi app/báo cáo; script không tự tạo backup/archive. CSV không đủ phục hồi toàn database.
5. Chạy `releases/038_enable_weekly_sales_cleanup.sql`: cài pg_cron nếu cần, kiểm UTC/GMT, named schedule `0 20 * * 0` (Chủ nhật 20:00 UTC = thứ Hai 03:00 Việt Nam), enabled=true. Chạy lại script chỉ cập nhật đúng named job, không tạo trùng và không chạy dọn ngay.
6. SQL trả jobname/schedule/active; mở báo cáo → Kiểm tra lịch dọn, phải báo đang bật. Vào Supabase → Integrations/Cron → Jobs → pos-weekly-sales-retention → History để kiểm tra lần chạy. Nếu lỗi lock/FK, transaction rollback; sửa nguyên nhân rồi lên lịch chạy lại có kiểm tra, không dùng CASCADE.

Có thể tạm dừng trong app hoặc chạy `releases/038_pause_weekly_sales_cleanup.sql`. Cờ paused làm job no-op; không ảnh hưởng hoạt động POS. Rollback 038 cũng chỉ pause; **giữ mã chống phát lại và trigger** vì đã có thể xóa đơn. Muốn phục hồi đơn phải có backup riêng và kế hoạch đối soát, không dùng rollback schema.

Môi trường trợ lý không có quyền quản trị Supabase, nên chưa chạy SQL/schedule và chưa xóa giao dịch thật. Không chạy lại reset dữ liệu thử 035 để thay chức năng này. Giữ dữ liệu theo nhu cầu chứng từ/kế toán trước khi bật xóa; user đã chọn giữ 30 ngày.

## Kiểm chứng

- Build TypeScript/Vite/PWA; XLSX lazy-loaded, không thêm CDN hay thư viện runtime.
- Full SQL fixture 003–038: mọi biên 06/09/11/13/15/17/22 và microseconds, lọc một giây/giao ngày, sum slot khớp tổng, slot 0; không trùng/mất tiền. Business writes trong test được rollback.
- Retention: old/recent/open/unfinished/canceled, invoice mới trong session cũ, done_at mới, linked old/new và old/old, unknown FK atomic rollback, pause/repeat, anti-replay, không reset invoice number; giữ accounts/menu/tables/images. Scheduled SQL kiểm qua pg_cron API fixture: đúng job/UTC/idempotency, không phải scheduler hosted thật.
- UI: WebKit (engine Safari) và Chromium API mock, select 60 giá trị giây, HH:mm:ss payload, presets/stale/export guards, mobile/desktop, tải XLSX.
- Workbook đọc bằng openpyxl độc lập: ZIP hợp lệ, 5 sheet, tiền là numeric, freeze header, tiếng Việt/XML, tên món giống formula vẫn là chuỗi literal, tổng khớp. Chưa mở bằng Microsoft Excel bản desktop trong môi trường này.
- Không ghi data hoặc thử xóa trên Supabase production. WebKit dùng engine Linux của Playwright với thư viện đặt riêng trong /tmp; chưa kiểm trên iPhone vật lý.

Nguồn lịch Cron: https://supabase.com/docs/guides/cron/quickstart (job có tên được cập nhật khi dùng lại tên, ví dụ timezone GMT; quản lý History trong Dashboard).
