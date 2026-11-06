# Giao diện theo ảnh tham khảo

- Giữ logo gốc và panorama Sài Gòn đang có. Nền kem, chữ nâu, màu cam, thẻ bo tròn.
- Điện thoại: logo giữa, tổng quan thật, bộ lọc và tìm bàn, lưới hai cột, thanh điều hướng dưới. Đồng bộ ở góc trên trái.
- Máy tính từ 1024px: menu trái theo quyền, kết nối và đồng bộ phía trên, lưới 3–4 cột theo chiều rộng. Không thêm menu giả.
- Bàn có phiên mở có nền cam nhạt. Bàn có phiếu bếp đang làm sớm nhất được tô cam đậm; tiêu đề giải thích trạng thái này. Tổng tiền và số bàn dùng dữ liệu hiện tại.
- Mở bàn vẫn dùng luồng gọi món và thanh toán hiện có. Không đổi SQL, Edge Function hoặc dữ liệu.

## Kiểm tra

Build thành công. `tests/reference-theme-flow.mjs` kiểm tra ba vai trò, số liệu/tiền, bộ lọc/tìm kiếm, 320–1440px, menu theo quyền, mở bàn/thanh toán, Bếp. Kiểm tra lại payment-layout-flow và reorder-saved-flow với URL máy chủ thử nghiệm; mọi API dùng dữ liệu giả, không tác động production.

Chưa kiểm tra trên iPhone vật lý. WebKit cục bộ không khởi chạy do môi trường thiếu thư viện hệ thống.

Sau cập nhật: hoàn tất thao tác đang chờ, đóng mọi cửa sổ POS và app đã cài, rồi mở lại để nhận bản PWA mới.
