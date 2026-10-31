# Cài POS ra màn hình chính

Giao diện hiện tại, Supabase Auth, quyền nhân viên, RPC thanh toán và dữ liệu cũ được giữ nguyên. Không có SQL hoặc Edge Function mới.

## Sử dụng

- iPhone/iPad: mở địa chỉ POS bằng Safari → Chia sẻ → Thêm vào Màn hình chính → Thêm.
- Android: Chrome → Cài app trong POS hoặc menu ⋮ → Cài đặt ứng dụng / Thêm vào màn hình chính.
- Máy tính: Chrome/Edge → biểu tượng cài đặt trên thanh địa chỉ. Trình duyệt có thể hiện tên mục khác nhau.
- Khi đã cài, mở biểu tượng logo quán. Cửa sổ chạy riêng, hỗ trợ safe area trên iPhone. Đây là web app cài qua trình duyệt, không cần App Store.
- Cần truy cập online ít nhất một lần để cài và lưu phần giao diện. Chế độ riêng tư hoặc hạn chế của trình duyệt có thể làm chức năng cài không khả dụng.

## Kết nối và dữ liệu

Service worker chỉ lưu danh sách tệp tĩnh của đúng bản build: HTML, JavaScript, CSS, manifest và hình. Không lưu phản hồi Auth, REST, Edge Function, yêu cầu POST hoặc yêu cầu có Authorization. Không có hàng đợi tự động thanh toán/gửi đơn khi trở lại mạng.

Khi mất mạng, giao diện đã tải có thể mở; dữ liệu bàn mới vẫn cần tải từ Supabase và quyền vẫn cần xác minh. POS báo mất kết nối, chặn gửi món, thanh toán và hoàn thành bếp. Không hỗ trợ làm việc với dữ liệu nghiệp vụ ngoại tuyến.

Các mã gửi đơn/thanh toán đang chờ được lưu theo cơ chế idempotency hiện có. **Món mới chọn nhưng chưa gửi chỉ nằm trong bộ nhớ phiên**, có thể mất nếu hệ điều hành đóng app. Trước khi đóng để cập nhật, gửi/xác nhận đơn hoặc chọn lại. Cảnh báo đóng tab chỉ có tác dụng trong trình duyệt hỗ trợ; không bảo đảm ngăn được iOS đóng app. Không xóa dữ liệu trình duyệt khi có yêu cầu đang chờ.

## Cập nhật an toàn

Không gọi `skipWaiting`, không tải lại trang khi controller thay đổi. Bản mới precache riêng và chờ tất cả cửa sổ đang dùng bản cũ đóng. POS hiển thị thông báo cập nhật tại màn hình chính/quản lý; thông báo không chen vào màn hình gọi món. Hoàn tất các thao tác đang chờ, quay lại danh sách bàn rồi đóng tất cả cửa sổ POS và mở lại.

`build-pwa.mjs` tạo phiên bản từ nội dung toàn bộ tệp tĩnh sau Vite build. HTML và asset dùng cùng bộ cache, tránh trộn hai bản. Cache cũ chỉ được dọn lúc bản mới kích hoạt. `vercel.json` yêu cầu kiểm tra lại sw.js và manifest thay vì giữ bản cũ ở HTTP cache. HTTPS bắt buộc khi cài production; localhost dùng cho phát triển. Vite dev không đăng ký worker.

## Kiểm tra đã tự động hóa

`npm run test:pwa` build và chạy Chromium localhost: manifest/logo đúng kích thước; hướng dẫn cài; install prompt chỉ gọi khi bấm nút; hai cửa sổ chặn worker mới kích hoạt; không mất trang đang mở khi phát hiện cập nhật; chỉ cache tệp tĩnh; mở giao diện đã lưu khi offline; trở lại online. Kiểm tra gọi món/ghi chú/thanh toán dùng API giả lập, không phát sinh giao dịch thật.

Thao tác cài thực tế trên iOS/Android cần thực hiện trên thiết bị; không khẳng định đã bấm cài trên điện thoại của người dùng.

## Quay lại bản cũ

Lấy giao diện ổn định trước thay đổi, giữ cơ chế đăng ký worker và script build PWA rồi build/deploy lại. Worker phải được tạo lại với các tệp của giao diện muốn phục hồi. Sau đó hoàn tất công việc, đóng mọi cửa sổ POS và mở lại. Không chỉ xóa sw.js hoặc trả 404: máy đã cài vẫn có thể giữ cache cũ. Không xóa localStorage, không thay đổi SQL và không xóa lịch sử đơn/thanh toán.
