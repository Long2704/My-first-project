# Tối ưu frontend POS — 31/10/2026

## Thay đổi

- Dùng chung một Intl.NumberFormat cho định dạng tiền trên bàn, danh sách món, thanh toán, báo cáo. Giữ nguyên định dạng và số tiền; không thay cách tính tại server.
- ProductItem dùng React.memo, các hàm thay số lượng/ghi chú giữ tham chiếu ổn định. Khi đổi một món, các dòng khác có thể bỏ qua render. Callback giảm về 0 vẫn mở xác nhận; dùng ref đọc số lượng hiện tại thay vì giữ giá trị cũ.
- Kết quả tìm kiếm được memo theo thực đơn/danh mục/từ khóa. Tên không dấu được cache bằng WeakMap, cập nhật lại khi tên đổi; không giữ danh mục/món cũ khi server cập nhật.
- Giữ tham chiếu dữ liệu khi nội dung đồng bộ không đổi. Không giảm tần suất 5 giây, không bỏ kiểm tra get_my_access, không thay quyền hoặc giao dịch.
- RevenuePanel, AuditPanel, InvoiceHistory tải khi mở lần đầu; giữ component sau khi đã mở để không mất bộ lọc khi đổi màn hình. Lỗi tải module có màn hình quay về Phục vụ, không tự reload app hoặc xóa giỏ.
- Các màn hình ghi dữ liệu và khôi phục thao tác chờ (MenuPanel, TableManagement, PaymentPanel…) vẫn được mount như trước. Không trì hoãn đọc mã đang chờ sau reload.
- Tách vendor chứa thư viện thành asset có hash ổn định. Service worker mới chỉ tái sử dụng asset JS/CSS có hash trùng từ cache POS cũ. HTML/manifest/icon vẫn tải từ deployment hiện tại; API/Auth không được cache. Worker vẫn chờ tất cả cửa sổ cũ đóng, không skipWaiting hoặc tự tải lại. Phiên bản worker tính cả nội dung script build để thay logic worker cũng tạo phiên bản mới.

## Số liệu local

Cùng cấu hình local trước/sau: JavaScript cần cho entry trước là 563.145 byte; sau gồm app 105.930 + vendor 446.422 = 552.352 byte (giảm khoảng 1,9%). Gzip theo cùng cách đo: 161.218 → 158.722 byte. **Không được mô tả app nhẹ hơn 80% chỉ dựa vào entry đã tách vendor**. Tổng tệp cài PWA còn gồm các màn hình tải sau; lần cài đầu vẫn precache chúng.

Microbenchmark 20.000 lần định dạng tiền trên máy kiểm tra: tạo formatter mỗi lần 653 ms; dùng chung formatter 17 ms. Đây chỉ là thao tác định dạng, không phải app nhanh hơn tương ứng.

Browser Chromium, viewport 390×844, fixture 180 món/24 bàn, CPU throttle 4×: sau 20 lần thêm và nhập ghi chú vẫn chỉ tạo 1 formatter. Thời gian click qua Playwright median 158 ms, p95 358 ms; bao gồm driver/animation-frame và không có baseline UI tương đương nên không dùng làm tỷ lệ cải thiện. Không khẳng định đã đo trên điện thoại thật.

## Kiểm tra

- npm run test:frontend-performance: thực đơn lớn, CPU chậm, không tải ba module đọc khi mới mở, không tạo formatter mỗi click, tìm không dấu, giỏ/ghi chú, chuyển quản lý giữ bộ lọc, cập nhật giá từ server, tải module bị mất mạng vẫn về Phục vụ giữ giỏ.
- POS reference suite: 375/390/414/desktop, thêm/gộp/ghi chú/hủy chọn, submit/payment mất phản hồi giữ mã chống trùng.
- Payment/cancellation/recovery browser suites: tiền mặt/chuyển khoản/giảm giá/hóa đơn/hủy và khôi phục Owner vẫn đúng. Tất cả API và giao dịch dùng dữ liệu giả.
- PWA suite: mở nhiều cửa sổ, chờ kích hoạt, cache static, offline/reconnect, asset vendor không đổi không tải lại khi update.
- TypeScript/Vite build. Không thêm dependency; không còn cảnh báo chunk JS vượt 500 kB.

## Phát hành và rollback

Chỉ frontend/build; không SQL, không Edge Function, không gửi email hoặc đổi mật khẩu Owner. Revert commit tối ưu rồi build/deploy lại. Giữ nguyên cơ chế phát hành PWA và mã đơn/thanh toán đang chờ. Hoàn tất thao tác trước khi đóng mọi cửa sổ POS để nhận bản mới. Không xóa dữ liệu trình duyệt khi có giao dịch đang chờ.
