# Bếp: thứ tự thời gian chung và tải ảnh ngay khi chọn

Yêu cầu mới thay thế quy tắc đơn thường luôn trước ảnh ở PR #35.

- Đang làm: gộp đơn thường và phiếu ảnh theo thời gian tạo tăng dần. Đơn mới nằm sau phiếu ảnh cũ; ảnh mới cũng nằm đúng sau các đơn trước đó. Khóa React phân biệt order/image để giữ trạng thái thẻ khi thêm đơn.
- Nút Owner Tải ảnh lên nằm ngay sau Lịch sử. Bỏ khung tiêu đề/hướng dẫn, danh sách chờ bấm gửi và mục tải dở.
- Chọn ảnh tự tải từng file, không hỏi xác nhận, không cần bấm Gửi ảnh. Trong lúc tải hiển thị tiến độ ngay trên nút. Chỉ hiện hàng lỗi và Thử lại khi có lỗi thực.
- Giữ UUID/hash theo user trước khi gửi; retry sau mất ACK/reload dùng cùng UUID. Không replay tự động lúc online trở lại. Đăng xuất/rời màn hình dừng các file chưa bắt đầu.
- Quyền Owner/Kitchen/Waiter, kiểu ảnh/dung lượng, xác minh server, private Storage, SQL/RPC/Edge Function và nghiệp vụ bán hàng giữ theo PR #35. Đây là thay đổi frontend, không cần chạy SQL hoặc deploy lại Edge Function.
- Lịch sử vẫn giữ cách sắp trước đó; yêu cầu mới áp dụng hàng chờ Đang làm. Chuông vẫn nhận riêng normal orders như cũ.

Kiểm chứng: build TypeScript/Vite/PWA; Playwright API giả cho ba vai trò, normal → ảnh → normal mới → ảnh mới, nút cạnh Lịch sử ở mobile, tự gửi ba file, không có nút Gửi ảnh/dialog xác nhận, mất ACK/reload không trùng, lỗi file, offline, zoom/swipe/history/cache; hồi quy kitchen-tools, kitchen-access và payment-layout. Không tạo đơn, thanh toán hay phiếu thử trên production.
