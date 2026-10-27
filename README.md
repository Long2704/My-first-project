# Bún Riêu Góc Phố POS

React + TypeScript + Vite + Supabase. Hiện có đăng nhập, hồ sơ vai trò, 12 bàn, menu từ database, ghi chú món, gửi/lưu đơn, tổng tiền từng bàn, bếp theo FIFO và hoàn thành đơn.

Chưa có thanh toán, hủy món, chuyển/tách/gộp bàn hoặc bill, mang về, quản lý menu trong app, báo cáo, chuông, Wake Lock, quẹt đơn và PWA. Dùng đơn thử trước khi vận hành thực tế. Chưa có quy trình đóng phiên bàn.

## Chạy phát triển

Yêu cầu Node.js 22.12+ hoặc 24, npm.

```sh
npm ci --cache /tmp/bun-rieu-npm-cache
cp .env.example .env.local
npm run dev
```

Điền Project URL và publishable key vào `.env.local`. Không sử dụng service_role hay secret key. Tệp cục bộ này được Git bỏ qua. Không ghi đè nếu đã cấu hình.

```sh
npm run build
```

## Database

Các bảng profiles, menu_items, restaurant_tables và hàm current_staff_role được tạo theo SQL hướng dẫn trong cuộc trò chuyện. Tài khoản Auth phải có hồ sơ vai trò tương ứng; không tự cấp vai trò từ frontend.

Sau đó chạy `supabase/migrations/003_ordering.sql` một lần trong Supabase SQL Editor. Tệp không được tự chạy khi deploy Vercel. RPC kiểm tra quyền phía server; trình duyệt không có quyền trực tiếp ghi các bảng đơn hàng. Kiểm thử tài khoản chưa đăng nhập cho thấy không đọc được profiles hoặc menu_items.

## Gửi đơn và bếp

Chọn bàn, thêm món và ghi chú, bấm Gửi bếp. RPC lấy giá từ menu, lưu cả đợt đơn trong một giao dịch và chống trùng bằng request_id. Đơn chỉ có nước được đánh dấu done và không vào bếp. Giá đã lưu không thay đổi khi giá menu đổi. Bếp dùng nút Xong; chỉ bếp/thu ngân/chủ có quyền RPC này.

App đồng bộ bằng polling mỗi 5 giây, chưa dùng Realtime subscription. Khi đồng bộ lỗi, giữ dữ liệu cũ và hiển thị cảnh báo. Bếp hiện món ăn theo FIFO; lịch sử chỉ có đơn đã xong của phiên bàn chưa đóng.

Món chưa bấm gửi chỉ ở bộ nhớ trang. Trước khi gửi, app lưu mã yêu cầu và các dòng món vào localStorage theo tài khoản; nếu chưa xác nhận thành công, app khóa chỉnh sửa và giữ nguyên mã để Thử gửi lại, kể cả sau tải lại/đăng nhập lại trên cùng thiết bị. Không tự gửi lại khi có mạng; không xóa dữ liệu trình duyệt khi còn đơn chờ. Sau thành công, phần Đơn đã lưu của bàn hiển thị tên món, giá và ghi chú.

Tổng trên bàn gồm món chưa thanh toán đã lưu cộng món đang chọn. Nếu đơn chờ đã xuất hiện trong database, không cộng giỏ chờ lần hai. Giỏ chưa gửi không đồng bộ sang thiết bị khác.

## Vercel

Framework: Vite. Build command: `npm run build`. Output directory: `dist`.
Thêm VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY trong cấu hình dự án Vercel rồi triển khai lại. Biến VITE_ được đưa vào frontend, không đặt bí mật vào đó.

## Kiểm tra trình duyệt

Cần Chromium (`CHROMIUM_PATH` nếu không ở /usr/bin/chromium). Chạy `npm run dev` trong một terminal, rồi `npm run test:browser` trong terminal khác. Test dùng Supabase giả lập hoàn toàn, không tạo đơn thật: đăng nhập, 12 bàn, chọn món/ghi chú, tổng 61.000đ, mất phản hồi sau khi server nhận đơn, khôi phục sau reload và gửi lại cùng mã, bếp lọc nước, hoàn thành và lịch sử, chiều ngang mobile.

Chưa thay thế việc kiểm thử RPC/RLS trên Supabase thật bằng tài khoản từng vai trò. Kiểm tra thực tế: điện thoại gửi món có ghi chú, tablet nhận trong khoảng 5 giây, hoàn thành từ bếp và kiểm tra trạng thái bàn; tải lại trang để xác nhận đơn đã lưu. Kiểm tra riêng đơn chỉ có nước không vào bếp. Phục vụ phải bị server từ chối hoàn thành đơn; tài khoản bếp phải bị từ chối gửi đơn.

## Chuẩn bị thanh toán

Sau migration 003, chạy `supabase/migrations/004_payments.sql` một lần trong Supabase SQL Editor. Tạo bills, bill_items, bill_orders và audit_log; thêm liên kết hóa đơn vào order_items. Chưa có giao diện thanh toán trong bản này.

RPC pay_bill chỉ cho thu ngân/chủ. Giá lấy từ order_items đã lưu; kiểm tra đúng phiên bàn và danh sách món trước khi thu tiền. Khóa bàn cùng thứ tự với gửi đơn, bảo vệ bằng request_id và chụp hóa đơn trong một giao dịch; đóng phiên khi không còn món chưa trả. Không xóa hoặc đánh dấu xong đơn bếp khi thanh toán.

`npm run test:sql` kiểm thử các migration trên PostgreSQL-compatible PGlite cục bộ, không kết nối Supabase: quyền vai trò, RLS, từ chối ghi trực tiếp hóa đơn, gửi lại đơn/thanh toán, tiền thiếu, danh sách món thay đổi, giảm giá, tiền thối, chuyển khoản, snapshot giá, phiên bàn cũ và đơn đã trả nhưng chưa làm xong. Chưa kiểm thử nhiều phiên database đồng thời hay thanh toán trên Supabase thật.
