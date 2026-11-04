# Ô giờ gọn, chọn đủ giây trên iOS/Android

ReportClock hiển thị một nút như ô nhập, giá trị 24 giờ `HH:mm:ss` và biểu tượng đồng hồ. Bấm mở native modal dialog tùy chỉnh với 3 select Giờ/Phút/Giây, output xem trước và Hủy/Áp dụng.

Chỉ Áp dụng cập nhật mốc báo cáo. Hủy, Escape hoặc bấm ngoài hộp bỏ draft; dùng showModal để focus trap/inert bên ngoài, trả focus về ô giờ khi đóng. Các nút type=button không tự submit form. Khi báo cáo đang tải, ô khóa và dialog đóng. Không dùng input time native, nên chọn giây không phụ thuộc picker hệ điều hành.

Không đổi RPC, SQL, Excel, lịch dọn hoặc dữ liệu. Giữ các quy tắc giờ Việt Nam/giây cuối/ẩn báo cáo cũ khi áp dụng mốc khác.

Validation: build TS/Vite/PWA; revenue-flow trên Chromium và WebKit ở 375/390/768/1024/1440, giờ/phút/giây, draft isolation, Hủy/Escape/focus restoration, áp dụng/preset, XLSX/CSV và stale guards. API giả, không ghi production. WebKit Linux engine, chưa kiểm iPhone vật lý.
