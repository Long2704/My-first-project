# 036 — Lọc doanh thu theo ngày, giờ, phút, giây

Báo cáo Owner thêm Từ giờ/Đến giờ (`time` step=1) cạnh ngày. Mọi mốc là giờ Việt Nam (`Asia/Ho_Chi_Minh`), không lấy múi giờ thiết bị để đổi dữ liệu. Mặc định 00:00:00–23:59:59. Hôm nay/Tháng này đặt lại cả ngày và giờ rồi người dùng bấm Xem báo cáo.

Ví dụ: 03/11/2026 08:30:15 → 03/11/2026 15:45:30 chỉ lấy hóa đơn `paid_at` trong cửa sổ đó. Bao gồm toàn bộ giây kết thúc: SQL dùng `[start, end + 1 second)` để giữ hóa đơn có microseconds trong giây cuối và loại giây tiếp theo. Hai mốc bằng nhau chọn một giây. Tối đa 366 ngày lịch, kể cả ngày đầu/cuối. Ngày giờ thiếu, đảo mốc, vô cực hoặc đầu vào có phần lẻ giây bị từ chối.

## Database

Thêm RPC tên riêng `revenue_report_window(timestamp without time zone,timestamp without time zone)`, tham số `p_from_local`/`p_to_local`. Không overload tên `revenue_report` để tránh PostgREST phân giải nhầm giữa date và timestamp. Giữ nguyên RPC date cũ cho client cũ. Không ghi/chỉnh/xóa bảng bán hàng; không thay pay_bill, quyền thanh toán hoặc lịch sử.

Hàm mới kiểm `auth.uid()` và `has_permission('reports.read')`, chỉ grant EXECUTE authenticated, không anon/PUBLIC. Một materialized selected CTE làm nguồn chung cho tổng, từng ngày và tất cả sản phẩm, dựa `paid_at`, snapshot hóa đơn, không menu hiện tại/đơn chưa thanh toán. Giữ tiền mặt/chuyển khoản/giảm giá và nhóm ngày theo Việt Nam.

## Giao diện và CSV

- Khi chỉ đổi giây/ngày, ẩn kết quả và nút CSV của khoảng cũ; không gắn số cũ dưới bộ lọc mới.
- Đáp ứng hợp lệ phải có `products_complete`, `time_filter` và echo chính xác from/to; backend chưa cập nhật hoặc trả khoảng khác thì không hiện số liệu.
- Dòng khoảng báo cáo hiển thị dd/MM/yyyy HH:mm:ss và Giờ Việt Nam.
- CSV lưu đủ hai mốc giờ địa phương, tiêu đề ghi Việt Nam. Tên file thay dấu `:` bằng `-` để tải được trên Windows; định dạng CSV ngày cũ vẫn tương thích. BOM tiếng Việt/formula escaping giữ nguyên.
- Native date/time có thể hiển thị theo ngôn ngữ/định dạng của thiết bị (12h/24h); giá trị gửi server và khoảng kết quả chuẩn 24h, luôn có giây.

## Thứ tự áp dụng

1. Chạy nguyên `supabase/migrations/036_revenue_time_filter.sql` một lần trong SQL Editor project quán đã có 035. SQL chỉ thêm RPC/permissions, giữ hàm date cũ; không cần dừng gửi đơn/thu tiền.
2. Sau Success mới phát hành frontend qua main/Vercel; không deploy Edge, không thay .env. Môi trường trợ lý không có kết nối quản trị Supabase nên chưa chạy migration lên project thật.
3. Sau Vercel thành công, xử lý yêu cầu POS đang chờ, đóng mọi cửa sổ POS của tên miền rồi mở lại như cơ chế cập nhật hiện hành. Mở báo cáo, chọn khoảng, bấm Xem báo cáo.
4. Nếu gặp PGRST202/42883, kiểm tra SQL 036 đã áp dụng đúng project và schema cache. Migration có NOTIFY pgrst reload schema; không fallback báo cáo cả ngày khi đã chọn giờ.

Rollback frontend về bản ngày trước, rồi chạy `supabase/rollbacks/036_revenue_time_filter.sql`. Chỉ gỡ RPC mới, không xóa bất kỳ giao dịch nào. Không chạy reset dữ liệu thử.

## Kiểm chứng

- `npm run build` — TypeScript/Vite/PWA.
- `npm run test:revenue-time` — helper ngày giờ/CSV và fixture nghiệp vụ thực 003–035 áp dụng 036; biên giây/microseconds/ngày, timezone database khác VN, trọn ngày bằng RPC cũ, tiền/giảm giá/món snapshot, loại đơn chưa trả, role/anon/Owner khóa/phiên cũ, giới hạn 366 ngày, từ chối fractional endpoints, migration/report/rollback giữ nguyên bảng.
- `POS_TEST_URL=http://127.0.0.1:5181 node tests/revenue-flow.mjs` — Chromium API giả, browser timezone America/Los_Angeles, step=1, default/preset, đổi giây ẩn kết quả/CSV, same/reversed/empty time, 375/390/768/1024/1440px, CSV và thiếu SQL/wrong-window guards.
- `node tests/revenue-export.mjs` — tương thích file báo cáo ngày cũ, BOM/escape/amounts.

Kiểm thử dùng dữ liệu giả, không tạo hóa đơn/đơn, không đổi timestamp hay chạy reset trên production. Bộ tài liệu PDF đã giao là bản đóng băng PR #37; lần này cập nhật tính năng báo cáo trong code và trang tài liệu này.
