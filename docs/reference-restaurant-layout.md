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

## Nền rõ và đồng bộ menu/thanh toán

Dùng `public/brand/vietnam-streetscape.svg` thay ảnh panorama cắt từ screenshot có độ phân giải thấp. Nền vector giữ nét khi phóng lớn, được tải cùng bản PWA. Logo gốc giữ nguyên.

`cream-pos-theme.css` được nạp sau CSS của các component để các tab danh mục, ảnh biểu tượng món, bộ đếm, ghi chú, đơn đã lưu, thực đơn quản lý, tiền mặt/chuyển khoản, số tiền và nút xác nhận đều dùng kem–cam. Giữ màu đỏ cho lỗi và thao tác hủy. Không thay đổi xử lý tiền hoặc RPC. Thêm khoảng cuộn để ô sửa thực đơn không bị thanh điều hướng dưới che.

Kiểm tra: build; reference-theme-flow (3 vai trò, 320–1440px); payment-layout-flow (3 vai trò, tiền mặt/chuyển khoản, màn hình thấp, retry); reorder-saved-flow; smoke thực đơn (kiểm tra nhập, lưu lại cùng mã sau tải lại, sửa giá, hết món và tổng đơn đã lưu). Tất cả bằng API giả. Chưa kiểm tra iPhone vật lý.
