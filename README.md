# Bún Riêu Góc Phố POS

React + TypeScript + Vite + Supabase. Hiện có đăng nhập, hồ sơ vai trò, 12 bàn, menu từ database, ghi chú món, gửi/lưu đơn, tổng tiền từng bàn, bếp theo FIFO và hoàn thành đơn, thanh toán và hóa đơn in được.

Chưa có hủy một phần số lượng, chuyển/tách/gộp bàn hoặc bill, mang về, quản lý menu trong app, chuông, Wake Lock, quẹt đơn và PWA. Dùng đơn thử trước khi vận hành thực tế. Thanh toán toàn bộ Bill 1 sẽ đóng phiên bàn; đơn bếp chưa xong vẫn ở hàng chờ.

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

Sau migration 003, chạy `supabase/migrations/004_payments.sql` một lần trong Supabase SQL Editor. Tạo bills, bill_items, bill_orders và audit_log; thêm liên kết hóa đơn vào order_items. Giao diện thanh toán chỉ hiện cho thu ngân/chủ sau khi chọn bàn có món đã lưu.

RPC pay_bill chỉ cho thu ngân/chủ. Giá lấy từ order_items đã lưu; kiểm tra đúng phiên bàn và danh sách món trước khi thu tiền. Khóa bàn cùng thứ tự với gửi đơn, bảo vệ bằng request_id và chụp hóa đơn trong một giao dịch; đóng phiên khi không còn món chưa trả. Không xóa hoặc đánh dấu xong đơn bếp khi thanh toán.

`npm run test:sql` kiểm thử các migration trên PostgreSQL-compatible PGlite cục bộ, không kết nối Supabase: quyền vai trò, RLS, từ chối ghi trực tiếp hóa đơn, gửi lại đơn/thanh toán, tiền thiếu, danh sách món thay đổi, giảm giá, tiền thối, chuyển khoản, snapshot giá, phiên bàn cũ và đơn đã trả nhưng chưa làm xong. Chưa kiểm thử nhiều phiên database đồng thời hay thanh toán trên Supabase thật.


## Thanh toán trên giao diện

Chạy migration 004 trước khi dùng. Chọn bàn → Thanh toán Bàn N. Gửi hoặc xóa các món đang chọn trước khi thanh toán. Hiện hỗ trợ thanh toán toàn bộ Bill 1; chưa có giao diện tách/gộp bill.

Giảm giá: nhập `10%` hoặc `10000`, nhập `0` để bỏ; chỉ hỗ trợ số nguyên, không dấu phân cách hàng nghìn. Chọn tiền mặt hoặc chuyển khoản. Tiền mặt: để trống tiền khách đưa để mặc định bằng số phải thu, hoặc nhập `100000`; app hiển thị tiền thối. Chuyển khoản: thu ngân phải kiểm tra giao dịch ngân hàng trước khi xác nhận; app không tự xác minh chuyển khoản.

Trước khi gửi, app lưu mã thanh toán cùng danh sách món và thông tin xác nhận trong localStorage theo tài khoản. Chưa rõ kết quả thì dùng Thử lại cùng mã, không thu lại tiền hoặc xóa dữ liệu trình duyệt. Nếu server xác nhận đã trả nhưng tải hóa đơn lỗi, nút thử lại chỉ tải hóa đơn. Một số lỗi xác định danh sách món/phiên đã đổi sẽ bỏ yêu cầu bị từ chối và yêu cầu kiểm tra lại; server không tự thu tiền cho lượt khách mới.

Hóa đơn lấy từ snapshot trong database, không tính lại theo menu hiện tại. Có tiền khách đưa và tiền thối nếu trả tiền mặt. In hóa đơn dùng window.print với CSS chỉ in nội dung hóa đơn; chưa tích hợp máy in nhiệt tự động. Nút Hóa đơn gần đây tải 30 hóa đơn mới nhất và mở/in lại. Mốc giờ hóa đơn hiển thị theo Asia/Ho_Chi_Minh.

`npm run test:payments` (cần dev server và Chromium như test:browser) kiểm thử giao diện bằng Supabase giả lập: tiền thiếu, giảm phần trăm/số tiền, tiền thối, giữ mã khi mất phản hồi/reload, chỉ tải lại hóa đơn sau thanh toán, chuyển khoản, từ chối snapshot cũ, bàn trống và giữ đơn bếp, mở lại hóa đơn, CSS in và ẩn thanh toán với phục vụ. Không tạo thanh toán thật trên Supabase và chưa kiểm chứng bản in vật lý.

## Hủy món và nhật ký

Chạy `supabase/migrations/005_cancellations_audit.sql` sau 004 trước khi dùng mã mới. Thu ngân/chủ chọn bàn → Hủy tên món → nhập lý do → Xác nhận hủy món. Hủy toàn bộ dòng chưa trả tiền, kể cả món đã ra; không hoàn tiền món đã thanh toán. Nếu mất phản hồi, thử lại cùng món là an toàn. Món được giữ nguyên để đối chiếu, loại khỏi tổng tiền và danh sách bếp. Hủy hết món chưa trả sẽ đóng phiên; nhật ký vẫn còn. Cần báo trực tiếp cho bếp nếu đã chuẩn bị món.

Nhật ký hoạt động dành cho thu ngân/chủ: 100 sự kiện mới nhất theo bộ lọc, giờ Việt Nam, mã nhân viên, lý do hủy và thông tin thanh toán. Ghi tự động phía server cho gửi đơn, hoàn thành bếp, hủy món và thanh toán; không tạo bù lịch sử gửi đơn/bếp trước migration 005. Client không được sửa/xóa nhật ký.

`npm run test:cancellations` kiểm tra migration, phân quyền, hủy lặp, lý do, tổng tiền sau hủy, snapshot thanh toán cũ và đóng phiên trên PGlite.

`npm run test:cancellation-ui` kiểm thử giao diện hủy, lý do bắt buộc, thử lại khi mất phản hồi, tổng còn lại, lọc bếp và nhật ký trên Chromium với Supabase giả lập. Cần dev server cấu hình endpoint giống các bài kiểm thử trình duyệt hiện có.

## Báo cáo doanh thu

Chạy `supabase/migrations/006_revenue_report.sql` sau 005. Migration chỉ thêm RPC đọc báo cáo, không sửa dữ liệu hóa đơn. Chủ quán/thu ngân mở Báo cáo doanh thu, chọn Từ ngày/Đến ngày (bao gồm cả hai ngày, tối đa 366 ngày), rồi bấm Xem báo cáo. Có nút Hôm nay và Tháng này; các nút chọn ngày cần bấm Xem báo cáo để tải.

Báo cáo tính theo `bills.paid_at` ở múi giờ Asia/Ho_Chi_Minh. Tổng thực thu sau giảm giá, số hóa đơn, tiền trước giảm giá, giảm giá, tiền mặt/chuyển khoản, doanh thu từng ngày và 20 tên món bán nhiều nhất. Tiền mặt là số phải thu trên hóa đơn, không phải tiền khách đưa trước khi thối. Món bán lấy từ snapshot bill_items, tiền món trước giảm giá chung hóa đơn; các món cùng tên được gộp. Không tính đơn chưa thanh toán hoặc món hủy trước thanh toán. Đây là doanh thu, chưa trừ chi phí và chưa phải lợi nhuận. Ngày không có hóa đơn không hiện thành dòng riêng.

Tổng, từng ngày và món bán được lấy cùng một snapshot phía database, không bị giới hạn 30/100 hóa đơn như các danh sách gần đây. RPC kiểm tra quyền chủ/thu ngân trên server. Nếu chưa chạy migration 006, giao diện báo cần cập nhật database và các luồng POS hiện có vẫn dùng bình thường. Đổi ngày hoặc tải lỗi sẽ không hiển thị số liệu của khoảng cũ dưới ngày mới.

Kiểm thử: `npm run test:revenue` dùng PGlite cho quyền, biên ngày Việt Nam, tổng tiền, giảm giá và khoảng ngày. `npm run test:revenue-ui` dùng Chromium/dev server và Supabase giả lập cho bộ lọc ngày, số liệu, lỗi kết nối/migration, dữ liệu trống và màn hình điện thoại. Chưa kiểm thử trên Supabase thật.
