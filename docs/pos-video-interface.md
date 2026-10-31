# Giao diện POS theo video — 2026-10-31

## Phạm vi và tham chiếu
Video 12,93 giây, 512×1108: 0–4 giây danh sách món, 4–5 giây chọn một món và xem đơn, 5–10 giây chi tiết một món/65.000, 10–12 giây mở lại menu và quay về đơn. Đã lấy khung hình đều 0,5 giây để kiểm tra toàn bộ đoạn. Không dựng status bar, Dynamic Island hay nút AssistiveTouch giả trong web; dùng safe-area và viewport-fit=cover của thiết bị.

Màn chọn món có header 52px, danh mục pill, hàng 88px, hình món đơn sắc nền xanh nhạt 56px, tên 14px và giá 12px; bộ đếm xuất hiện sau chọn. Xem đơn là màn riêng, có chip thông tin bàn, dòng món, cộng nổi, tổng tiền và thao tác dưới cùng. Thanh đáy nằm trong workspace cố định 100dvh, danh sách có vùng scroll riêng nên không bị footer che. CSS chỉ dùng trắng, text #171717/#777, divider #eee, xanh #0066cc/#eaf3ff; đỏ được giữ cho thao tác nguy hiểm và nhận diện logo. Không dùng gradient hoặc shadow mạnh.

Logo quán được xử lý sạch nền từ ảnh người dùng, đặt ở public/brand/goc-pho-logo.webp (256px, khoảng36KB). Header chính và nhãn Chủ quán đổi thành Bún Riêu Góc Phố; không sửa role chu hay tên lịch sử trong database. Không đưa video gốc/ảnh tham chiếu của ứng dụng khác lên repository.

## Component
src/pos: POSHeader, CategoryTabs, ProductList/ProductItem, QuantityControl, OrderDetail/OrderItem, CustomerInfoChips, FloatingAddButton, OrderBottomBar, PaymentModal và SearchBar. types.ts chứa dữ liệu danh mục, kiểu sản phẩm/bàn, tìm kiếm và phép tính tiền giỏ. ServiceWorkspace ghép hai màn bằng props; dữ liệu giỏ/RPC vẫn ở App hiện có. PaymentModal dùng lại PaymentPanel thay vì tạo cơ chế thanh toán mới.

## Nghiệp vụ giữ nguyên
- Bàn trống mở menu; bàn có đơn mở chi tiết. Xem đơn/Thêm món/Back giữ giỏ và ghi chú của đúng bàn trong phiên app. Thêm cùng món chưa gửi dùng cùng một dòng/qty, giới hạn99. Giảm về0 hoặc xóa chọn có xác nhận. Không gom món đã gửi với giỏ mới vì có trạng thái bếp, snapshot giá và quyền hủy khác nhau.
- Món đã gửi được hiển thị trạng thái/qty chỉ đọc; hủy theo orders.cancel hiện có. Không cho sửa đơn đã thanh toán. Menu danh mục lấy đúng nhóm hiện hành, không giả tầng Trệt, mã order hoặc thông tin khách không có.
- Gửi bếp và thanh toán tiếp tục dùng RPC hiện có, expected_price, request UUID bền vững, giá/tổng tiền server và receipt thật. Khi server đã có order của pending UUID, không cộng giỏ lại vào tổng. Khi thanh toán pending, hiển thị số tiền của request cũ và mở lại cùng mã. Tách/gộp/chuyển/hủy cả bàn vẫn qua popup hiện có.
- PaymentPanel giữ một instance xuyên suốt, trigger compact dùng ref. Không mất pending/receipt khi chuyển menu/chi tiết, đóng bàn hoặc sang lịch sử hóa đơn. Multi-bill chọn ngay trong modal, giảm giá chỉ Owner.
- Thông tin khách và số khách là thông tin giao diện lưu trên thiết bị theo nhân viên/bàn, không đồng bộ giữa các thiết bị. Ghi chú đơn được ghép vào ghi chú từng món chưa gửi khi submit; tổng ghi chú tối đa500 ký tự, vượt thì báo trước khi gửi. Metadata thiết bị được xóa khi nhận biết phiên bàn đã kết thúc. Không thay schema hoặc thêm RPC cho các chip.
- Món chưa gửi chỉ được giữ qua chuyển màn hình; reload bảo toàn các request đã gửi nhưng chờ xác nhận như cơ chế cũ, không tuyên bố lưu tự động mọi giỏ chưa gửi qua reload.

## Kiểm tra
npm run build. tests/pos-reference-flow.mjs: chọn/gộp qty, xóa có xác nhận, lọc/tìm không dấu, qua lại giữ giỏ/ghi chú, guest/customer/note, 375/390/414 và desktop1440 không tràn; footer trong viewport; lost submit, reload cùng UUID, không đếm trùng; cash/receipt và lost payment retry không tạo hóa đơn trùng; logo và nhãn.
Hồi quy: order-flow, cancellation-flow (hủy/audit), payment-flow (cash/transfer/discount/stale/receipt-only retry), table-actions-flow (chuyển bàn có đơn/tách bill), kitchen-tools-flow; employee-directory/create/management/password-reset/deletion UI. Tất cả dùng API/device giả lập, không tạo giao dịch thật. Không coi các ca đó là kiểm thử Safari phần cứng hay kết nối Supabase production. Các kiểm thử bố cục cũ được thay đường chạy bởi suite pos-reference khi dùng npm scripts.

## Phát hành và quay lại
Không cần SQL, không thay Auth/backend, không đổi .env. Merge PR vào main theo quyền người dùng đã cấp, theo dõi Vercel. Nếu cần quay lại, revert riêng commit/merge giao diện hoặc rollback deployment trước; không restore database hay xóa localStorage pending. File ảnh logo là asset duy nhất dạng binary. Khách/số khách lưu cục bộ như mô tả trên, chưa có quản lý khách hàng dùng chung.
