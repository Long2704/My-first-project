# Bước 024 — quản lý bàn, báo cáo, hóa đơn và nhật ký

## Kết quả

- Quản lý bàn: bỏ tiêu đề/mô tả lặp lại; Thêm bàn bên trái, Tải lại bên phải.
  Kéo/thao tác bàn giữ nguyên. Khi thứ tự thay đổi, cùng hàng công cụ chuyển thành
  Lưu thứ tự bàn / Hủy sắp xếp để không làm các hàng nhảy giữa lúc kéo.
  Nút sửa chỉ hiện Sửa, tên truy cập vẫn chỉ rõ bàn. Bàn bận vẫn không sửa được.
- Báo cáo: bỏ phần mô tả dài và xuất 20 món CSV; chỉ giữ CSV doanh thu.
  Danh sách Món ăn lấy TẤT CẢ tên món trên hóa đơn đã trả trong khoảng ngày chọn,
  gồm món chính, món phụ, nước; hiển thị tên, số lượng và tổng tiền trước giảm giá.
  Không lấy giá mới trong menu hoặc đơn chưa trả. Mốc ngày theo Asia/Ho_Chi_Minh.
  Doanh thu thực thu vẫn sau giảm giá; không đổi số tiền trên hóa đơn.
- Bỏ window.print(), nút in, CSS in và lời mời in lại; giữ xác nhận thanh toán,
  xem hóa đơn, dữ liệu giao dịch, actor/thời gian và cơ chế thử lại mã cũ.
- Ngừng ghi MỚI table_order, table_update, takeaway_created, takeaway_discarded,
  menu_update trong audit_log bằng trigger BEFORE INSERT. Không xóa dòng cũ.
  UI loại năm loại đó khỏi bộ lọc và truy vấn trước khi giới hạn 100 dòng.
  Thanh toán, hủy, chuyển/tách bill, gửi đơn, hoàn thành bếp vẫn được ghi.
  Các bảng mã yêu cầu vẫn được giữ để chống gửi lại; không bỏ idempotency.

## SQL và tương thích

`supabase/migrations/024_management_reports_audit.sql` áp dụng sau 023.
Một giao dịch, không xóa hoặc cập nhật dữ liệu lịch sử. Giữ nguyên signature RPC
revenue_report(date,date), thêm cờ products_complete=true để frontend mới không
nhầm báo cáo top 20 cũ thành danh sách đầy đủ. Quyền báo cáo dùng reports.read,
hiện chỉ Owner đang hoạt động có quyền; Waiter/Kitchen/thu_ngan cũ bị từ chối.
Truy vấn tổng, ngày và món dùng cùng snapshot; giữ index paid_at và bill_items.bill_id.

Chỉ áp dụng trên project THỬ NGHIỆM. Chưa có kết nối trực tiếp Supabase của người
dùng trong môi trường lập trình này. Không đẩy GitHub hoặc tự deploy.

## Cách áp dụng

1. Giữ một bản sao của bảy file frontend hiện tại trước khi thay.
2. Chạy TOÀN BỘ SQL 024 một lần trong SQL Editor của project thử nghiệm đã có 023.
   Không chạy lại 017–023, không chạy file trong rollbacks.
3. Cập nhật cùng nhau:
   src/TableManagement.tsx, src/RevenuePanel.tsx, src/revenue-export.ts,
   src/PaymentPanel.tsx, src/InvoiceHistory.tsx, src/OperationsPanel.tsx, src/style.css.
4. Giữ .env.local trỏ thử nghiệm, chạy npm.cmd run build rồi npm.cmd run dev.
5. Kiểm tra kéo/đổi thứ tự (chuột/chạm/bàn phím), sửa bàn trống, bàn bận bị chặn.
   Báo cáo theo ngày chọn, đủ món/nước, chỉ còn CSV doanh thu. Hóa đơn không có in.
   Bộ lọc nhật ký không còn năm loại đã bỏ. Không xóa đơn/hóa đơn để thử lại.

## Kiểm thử

- node tests/management-024-sql.mjs: 26 món, ba nhóm, giới hạn ngày VN ở hai biên,
  giá snapshot, giảm giá, khoảng rỗng/sai, owner-only, lịch sử giữ nguyên,
  ngừng đúng năm loại ghi mới, giao dịch/audit quan trọng vẫn ghi, durable requests,
  rollback và áp dụng lại. PGlite và Auth giả lập, không phải Supabase thật.
- node tests/revenue-export.mjs: CSV doanh thu/BOM/chống công thức/tổng/range/rỗng.
- Playwright: bàn, thứ tự chuột/chạm/bàn phím, báo cáo >20 món và guard thiếu 024,
  nhật ký, hóa đơn không in, thanh toán mất phản hồi/thử lại, tách bill, Kitchen,
  mang về, chuyển bàn, thực đơn và bố cục. Toàn bộ mạng Supabase giả lập.
- Build TypeScript/Vite và kiểm tra ảnh điện thoại.

## Quay lại

Dừng app mới, khôi phục bảy file frontend đã sao lưu và chạy
supabase/rollbacks/024_management_reports_audit.sql trên project thử nghiệm.
Hàm báo cáo quay về phiên bản trước; trigger ngừng ghi bị gỡ.
Không xóa giao dịch hoặc nhật ký. Việc ghi các loại đã bỏ được khôi phục từ lúc
rollback; KHÔNG thể tự tạo lại chính xác các sự kiện đã chủ động không ghi.
Không dùng CASCADE hoặc xóa bảng để quay lại. Không áp dụng production trước khi
kiểm chứng trên Supabase thử nghiệm, có backup phù hợp và người dùng đồng ý.
