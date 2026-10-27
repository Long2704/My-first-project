# Bún Riêu Góc Phố POS

React + TypeScript + Vite + Supabase. Hiện có đăng nhập, hồ sơ vai trò, 12 bàn, menu từ database, ghi chú món, gửi/lưu đơn, tổng tiền từng bàn, bếp theo FIFO và hoàn thành đơn, thanh toán và hóa đơn in được.

Chưa có hủy một phần số lượng, tách bàn, mang về, giữ sáng màn hình và PWA. Dùng đơn thử trước khi vận hành thực tế. Thanh toán hết các bill sẽ đóng phiên bàn; đơn bếp chưa xong vẫn ở hàng chờ.

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

Chạy migration 004 trước khi dùng. Chọn bàn → Thanh toán Bàn N. Gửi hoặc xóa các món đang chọn trước khi thanh toán. Sau migration 009, chọn Bill thanh toán để thu riêng từng bill; mỗi lượt thu toàn bộ món chưa trả của bill đã chọn.

Giảm giá: nhập `10%` hoặc `10000`, nhập `0` để bỏ; chỉ hỗ trợ số nguyên, không dấu phân cách hàng nghìn. Chọn tiền mặt hoặc chuyển khoản. Tiền mặt: để trống tiền khách đưa để mặc định bằng số phải thu, hoặc nhập `100000`; app hiển thị tiền thối. Chuyển khoản: thu ngân phải kiểm tra giao dịch ngân hàng trước khi xác nhận; app không tự xác minh chuyển khoản.

Trước khi gửi, app lưu mã thanh toán cùng danh sách món và thông tin xác nhận trong localStorage theo tài khoản. Chưa rõ kết quả thì dùng Thử lại cùng mã, không thu lại tiền hoặc xóa dữ liệu trình duyệt. Nếu server xác nhận đã trả nhưng tải hóa đơn lỗi, nút thử lại chỉ tải hóa đơn. Một số lỗi xác định danh sách món/phiên đã đổi sẽ bỏ yêu cầu bị từ chối và yêu cầu kiểm tra lại; server không tự thu tiền cho lượt khách mới.

Hóa đơn lấy từ snapshot trong database, không tính lại theo menu hiện tại. Có tiền khách đưa và tiền thối nếu trả tiền mặt. In hóa đơn dùng window.print với CSS chỉ in nội dung hóa đơn; chưa tích hợp máy in nhiệt tự động. Nút Hóa đơn gần đây tải 30 hóa đơn mới nhất và mở/in lại. Mốc giờ hóa đơn hiển thị theo Asia/Ho_Chi_Minh.

`npm run test:payments` (cần dev server và Chromium như test:browser) kiểm thử giao diện bằng Supabase giả lập: tiền thiếu, giảm phần trăm/số tiền, tiền thối, giữ mã khi mất phản hồi/reload, chỉ tải lại hóa đơn sau thanh toán, chuyển khoản, từ chối snapshot cũ, bàn trống và giữ đơn bếp, mở lại hóa đơn, CSS in và ẩn thanh toán với phục vụ. Không tạo thanh toán thật trên Supabase và chưa kiểm chứng bản in vật lý.

## Hủy món và nhật ký

Chạy `supabase/migrations/005_cancellations_audit.sql` sau 004 trước khi dùng mã mới. Thu ngân/chủ chọn bàn → Hủy tên món → xác nhận trong pop-up (sau migration 011, không nhập lý do). Hủy toàn bộ dòng chưa trả tiền, kể cả món đã ra; không hoàn tiền món đã thanh toán. Nếu mất phản hồi, thử lại cùng món là an toàn. Món được giữ nguyên để đối chiếu, loại khỏi tổng tiền và danh sách bếp. Hủy hết món chưa trả sẽ đóng phiên; nhật ký vẫn còn. Cần báo trực tiếp cho bếp nếu đã chuẩn bị món.

Nhật ký hoạt động dành cho thu ngân/chủ: 100 sự kiện mới nhất theo bộ lọc, giờ Việt Nam, mã nhân viên, lý do hủy và thông tin thanh toán. Ghi tự động phía server cho gửi đơn, hoàn thành bếp, hủy món và thanh toán; không tạo bù lịch sử gửi đơn/bếp trước migration 005. Client không được sửa/xóa nhật ký.

`npm run test:cancellations` kiểm tra migration, phân quyền, hủy lặp, lý do, tổng tiền sau hủy, snapshot thanh toán cũ và đóng phiên trên PGlite.

`npm run test:cancellation-ui` kiểm thử pop-up hủy món không lý do, thử lại khi mất phản hồi, tổng còn lại, lọc bếp và nhật ký trên Chromium với Supabase giả lập. Cần dev server cấu hình endpoint giống các bài kiểm thử trình duyệt hiện có.

## Báo cáo doanh thu

Chạy `supabase/migrations/006_revenue_report.sql` sau 005. Migration chỉ thêm RPC đọc báo cáo, không sửa dữ liệu hóa đơn. Chủ quán/thu ngân mở Báo cáo doanh thu, chọn Từ ngày/Đến ngày (bao gồm cả hai ngày, tối đa 366 ngày), rồi bấm Xem báo cáo. Có nút Hôm nay và Tháng này; các nút chọn ngày cần bấm Xem báo cáo để tải.

Báo cáo tính theo `bills.paid_at` ở múi giờ Asia/Ho_Chi_Minh. Tổng thực thu sau giảm giá, số hóa đơn, tiền trước giảm giá, giảm giá, tiền mặt/chuyển khoản, doanh thu từng ngày và 20 tên món bán nhiều nhất. Tiền mặt là số phải thu trên hóa đơn, không phải tiền khách đưa trước khi thối. Món bán lấy từ snapshot bill_items, tiền món trước giảm giá chung hóa đơn; các món cùng tên được gộp. Không tính đơn chưa thanh toán hoặc món hủy trước thanh toán. Đây là doanh thu, chưa trừ chi phí và chưa phải lợi nhuận. Ngày không có hóa đơn không hiện thành dòng riêng.

Tổng, từng ngày và món bán được lấy cùng một snapshot phía database, không bị giới hạn 30/100 hóa đơn như các danh sách gần đây. RPC kiểm tra quyền chủ/thu ngân trên server. Nếu chưa chạy migration 006, giao diện báo cần cập nhật database và các luồng POS hiện có vẫn dùng bình thường. Đổi ngày hoặc tải lỗi sẽ không hiển thị số liệu của khoảng cũ dưới ngày mới.

Kiểm thử: `npm run test:revenue` dùng PGlite cho quyền, biên ngày Việt Nam, tổng tiền, giảm giá và khoảng ngày. `npm run test:revenue-ui` dùng Chromium/dev server và Supabase giả lập cho bộ lọc ngày, số liệu, lỗi kết nối/migration, dữ liệu trống và màn hình điện thoại. Chưa kiểm thử trên Supabase thật.

## Chuyển bàn

Chạy `supabase/migrations/007_table_transfer.sql` sau 006 trước khi dùng giao diện chuyển bàn. Thu ngân/chủ chọn bàn có phiên khách → Chuyển Bàn N → chọn bàn trống → Xác nhận chuyển bàn (sau migration 011, không nhập lý do). Chuyển toàn bộ phiên, không gộp vào bàn đang có khách. Giá, món, ghi chú và thứ tự/trạng thái bếp được giữ nguyên; màn hình bếp và tổng tiền theo bàn mới sau đồng bộ. Báo trực tiếp bếp/phục vụ vị trí mới. Các hóa đơn đã trả trước đó giữ số bàn trong snapshot cũ.

Gửi hoặc xóa các giỏ món đang chọn trước khi chuyển. Trên cùng thiết bị, yêu cầu chuyển chờ sẽ khóa gọi món/thanh toán/hủy món/đăng xuất cho đến khi xác nhận kết quả. App lưu mã yêu cầu theo tài khoản vào localStorage; mất phản hồi hoặc tải lại trang thì dùng Thử lại cùng mã chuyển bàn. Không xóa dữ liệu trình duyệt khi còn yêu cầu chờ. Nếu server từ chối vì bàn đích vừa có khách, app đồng bộ và cho chọn lại. Chưa hỗ trợ tự thử lại khi có mạng.

RPC khóa hai bàn theo thứ tự id rồi khóa phiên khách, kiểm tra phiên còn mở, bàn nguồn còn đúng và bàn đích còn trống; ghi chuyển bàn và nhật ký cùng giao dịch. Migration lưu bàn gốc của đơn để gửi lại mã đơn cũ sau chuyển không bị trùng. Thanh toán/hủy kiểm tra lại vị trí phiên sau khi lấy khóa để từ chối dữ liệu vừa bị thay đổi. Một thiết bị khác vẫn có thể giữ giỏ chưa gửi ở bàn cũ: giỏ chưa gửi chưa đồng bộ giữa thiết bị, vì vậy cần báo nhân viên kiểm tra lại bàn trước khi gửi.

`npm run test:transfer` kiểm tra PGlite: phân quyền, bàn trùng/bận/ngừng hoạt động, giữ món/bếp, thử lại, gửi lại đơn bàn gốc sau chuyển, tái sử dụng bàn nguồn, hủy/thanh toán/hoàn thành sau chuyển, snapshot bàn trên hóa đơn và nhật ký. `npm run test:transfer-ui` kiểm tra Chromium với Supabase giả lập: xác nhận/lý do, chặn giỏ nháp, thử lại sau reload, tổng tiền và bếp theo bàn mới, xung đột bàn đích, nhật ký và mobile. Chưa kiểm chứng nhiều phiên PostgreSQL đồng thời hoặc Supabase thật.

## Quản lý thực đơn

Chạy `supabase/migrations/008_menu_management.sql` sau 007. Chủ quán mở Quản lý thực đơn → Thêm món mới hoặc Sửa tên món. Có tên, giá nguyên đồng (0–10.000.000), nhóm món, thứ tự (0–9999), Đang bán và Hết món tạm thời. Bỏ Đang bán để ngừng bán; bật lại để khôi phục. Không xóa món đã có lịch sử. Chỉ chủ quán được xem/sửa màn hình quản lý; RPC kiểm tra vai trò phía server, client không được trực tiếp ghi menu_items. Thu ngân/phục vụ/bếp tiếp tục xem menu bán theo quyền cũ.

Đơn đã lưu và hóa đơn giữ tên/giá snapshot cũ. Giá mới áp dụng khi gửi đơn mới. App đồng bộ cả thực đơn mỗi 5 giây và khi bấm Đồng bộ. Nếu giá thay đổi trong lúc gửi, server từ chối và rollback toàn bộ đơn, app bỏ yêu cầu đã bị từ chối và giữ giỏ để kiểm tra/gửi lại. Nếu giỏ có món hết/ngừng bán, app chặn gửi và yêu cầu Xóa chọn rồi chọn lại. Đơn chờ từ phiên bản cũ không có expected_price vẫn có thể thử lại theo giá server để tương thích; đơn đã được server nhận luôn trả về chính đơn cũ.

Gửi/xóa món đang chọn trước khi chỉnh menu. Trước khi lưu, app giữ request_id và dữ liệu cập nhật trong localStorage theo tài khoản; mất phản hồi hoặc reload thì dùng Thử lại cùng mã cập nhật. Không tạo lại món bằng mã khác khi chưa xác nhận. Phiên bản menu bảo vệ việc hai thiết bị cùng sửa: người lưu sau phải tải lại món đã đổi, tránh ghi đè thầm lặng. Nhật ký ghi thao tác và giá trị trước/sau.

`npm run test:menu` kiểm tra SQL PGlite: quyền chủ, thêm/sửa lặp, phiên bản cũ, dữ liệu sai, kiểm tra giá gửi đơn, hết/ngừng bán và snapshot đơn/hóa đơn. `npm run test:menu-ui` kiểm tra Chromium với Supabase giả lập: tạo/sửa, tải lại sau mất phản hồi, xung đột, ẩn món, đồng bộ menu, phục hồi giỏ khi giá đổi, mobile và ẩn quản lý với thu ngân. Chưa kiểm thử Supabase thật hoặc nhiều phiên PostgreSQL đồng thời.

## Tách/gộp bill và thu riêng

Chạy `supabase/migrations/009_split_bills.sql` sau 008. Thu ngân/chủ chọn bàn → Tách/gộp bill Bàn N → chọn Bill nguồn → tích dòng món → chọn Bill mới hoặc bill đang chưa trả cùng phiên → nhập lý do → Xác nhận tách/gộp bill. Chuyển cả số lượng của dòng; chưa chia số lượng trong cùng một dòng, chưa chia đều tiền và chưa gộp giữa các bàn. Chọn tất cả dòng để gộp toàn bill. Chỉ chuyển dòng chưa thanh toán và chưa hủy. Món, giá, ghi chú, đợt đơn và thứ tự/trạng thái bếp không đổi.

Chọn Bill thanh toán, kiểm tra số bill và món trong hộp xác nhận trước khi thu. Mỗi bill có giảm giá, phương thức trả và hóa đơn riêng. Bàn còn mở và tổng tiền bàn chỉ còn các món chưa trả sau khi thu một bill. Bàn chỉ đóng khi không còn món chưa trả (hoặc đã hủy hết số còn lại). Món bếp đã trả tiền vẫn tiếp tục làm. Hóa đơn và danh sách hóa đơn gần đây có số Bill. Báo cáo doanh thu cộng các hóa đơn đã trả, không đếm tiền chưa trả hoặc thao tác tách/gộp.

Món gọi thêm mặc định vào bill chưa trả có số nhỏ nhất; có thể chuyển sau đó bằng tách/gộp. Số bill mới luôn lớn hơn số bill từng có trong phiên, không dùng lại bill đã thanh toán. Trường hợp chỉ còn Bill 2 chưa trả, gọi thêm sẽ vào Bill 2.

RPC khóa bàn/phiên/dòng món, xác thực tất cả dòng cùng nguồn và cùng phiên, lưu request_id và ghi nhật ký trong cùng giao dịch. Không được ghi trực tiếp bảng bill_moves từ client. Trước khi gửi, app lưu mã tách/gộp trong localStorage theo tài khoản; mất phản hồi hoặc reload thì dùng Thử lại cùng mã tách/gộp. Không xóa bộ nhớ trình duyệt khi còn yêu cầu chờ. Mã thanh toán cũng giữ số bill đã chọn qua reload; dữ liệu thanh toán chờ từ bản cũ vẫn mặc định Bill 1. Nếu món/bill bị thay đổi ở thiết bị khác, server từ chối yêu cầu mới và app yêu cầu chọn lại.

`npm run test:bills` kiểm tra PGlite: quyền, dữ liệu sai, tách/gộp lặp, giữ món/bếp, từ chối snapshot thanh toán cũ, thu riêng và giảm giá, giữ bàn mở, gọi thêm vào bill chưa trả, món đã trả/hủy, bill đích và thử lại sau khi đóng bàn. `npm run test:bills-ui` kiểm tra Chromium với Supabase giả lập: lựa chọn, tách/gộp, reload/thử lại, thanh toán Bill 2 giữ đúng mã/số bill, số dư bàn, nhật ký và mobile. Chưa kiểm chứng Supabase thật hoặc nhiều phiên PostgreSQL đồng thời.

## Chuông đơn mới trên màn hình Bếp

Không cần migration SQL mới. Mở Bếp → Bật chuông đơn mới để nghe âm thử. Kiểm tra âm lượng thiết bị; nút Thử chuông phát lại âm mẫu, Tắt chuông đơn mới chỉ tắt âm, thông báo trực quan vẫn hoạt động. Sau khi reload hoặc rời Bếp rồi mở lại cần bật chuông lại. Đơn cũ ở lần đồng bộ đầu không báo lại; đơn mới nhận sau đó có nhãn Mới, viền và thông báo số đơn chưa xem. Xem đơn đang làm đưa về hàng chờ từ lịch sử. Đánh dấu đã xem chỉ xóa thông báo, không đổi trạng thái đơn; dùng Xong để hoàn thành món. Đơn đã hoàn thành hoặc hủy hết món sẽ rời danh sách mới. Chuyển bàn hoặc đồng bộ lại cùng id đơn không phát chuông lần nữa.

Cần trình duyệt hỗ trợ Web Audio. Chức năng không cài ứng dụng, không yêu cầu quyền thông báo và không gửi push. Giữ trang Bếp mở để nhận polling mỗi 5 giây; chuyển app/khóa máy có thể làm chậm đồng bộ và không bảo đảm chuông nền. Âm chỉ phát cho đơn mới nhận khi trang đang hiển thị. Thông báo Mới và các tùy chọn chỉ ở phiên trang hiện tại, không đồng bộ trạng thái đã xem giữa thiết bị.

`npm run test:kitchen-tools` dùng Chromium với Supabase và API thiết bị giả lập: không báo đơn cũ, phát/tắt chuông, chống báo lặp khi đổi bàn, đánh dấu đã xem, điều hướng từ lịch sử, không có nút hoặc yêu cầu giữ sáng, đóng audio và thiết bị không hỗ trợ. Cần kiểm tra âm lượng thực tế trên điện thoại/tablet của quán.

## Bố cục POS gọn

Màn hình Phục vụ tập trung vào sơ đồ bàn, tìm bàn và lọc Trống/Đang phục vụ. Chọn bàn mở thực đơn bên trái và đơn/thu ngân bên phải trên máy tính; trên điện thoại giỏ gửi bếp nằm cố định ở cuối màn hình. Có tìm món, nhãn trạng thái bàn và tổng chưa thanh toán. Chuyển bàn và tách/gộp bill nằm dưới Thao tác bàn khi chọn bàn.

Menu Quản lý trên thanh điều hướng mở các màn hình riêng: Quản lý thực đơn (chủ quán), Báo cáo doanh thu, Nhật ký hoạt động và Hóa đơn gần đây (chủ/thu ngân). Không còn xếp các bảng quản lý lên màn hình Phục vụ. Hóa đơn được mở bằng hộp thoại chung để xem/in lại từ màn hình hóa đơn. Các yêu cầu chờ vẫn giữ nguyên khi chuyển màn hình; thông báo dẫn về nơi xử lý nếu có cập nhật menu hoặc thao tác bàn chưa xác nhận. Giỏ món chưa gửi được giữ khi đổi màn hình trong cùng phiên trang.

Không có migration SQL cho bố cục này. `npm run test:layout` kiểm tra dashboard, bộ lọc/tìm bàn, thao tác theo ngữ cảnh, đổi màn hình giữ giỏ, xem/in hóa đơn, khôi phục thanh toán chờ và kích thước desktop/mobile bằng Chromium/Supabase giả lập. Các bài kiểm thử luồng đã chuyển sang menu Quản lý và Thao tác bàn tương ứng.

## Hủy món/bàn không lý do, vuốt bếp và đường đi bàn

Chạy `supabase/migrations/011_cancellations_kitchen_history.sql` sau 009 hoặc 010. Tệp 011 đã bao gồm việc bỏ ràng buộc lý do của 010; không cần chạy 010 riêng nếu chưa chạy. Migration giữ lịch sử cũ, cho phép hủy món không lý do, thêm hủy phiên bàn có snapshot và đường đi bàn trên table_sessions.

Chuyển bàn chỉ chọn bàn đích rồi xác nhận; không còn ô hoặc nút chọn lý do. Hủy món mở pop-up có tên/số lượng/tiền, Quay lại và Xác nhận hủy món. Không nhập lý do. Giữ nguyên quyền thu ngân/chủ; món đã trả không được hủy. Yêu cầu hủy dòng món thử lại theo cùng item id, không hủy trùng.

Trong Thao tác bàn có Hủy cả Bàn N. Pop-up liệt kê toàn bộ dòng món chưa trả của phiên qua tất cả bill. Xác nhận sẽ hủy các dòng đó, đóng phiên khi xong, giữ hóa đơn và món đã trả. Nếu còn món đã trả nhưng bếp chưa làm xong thì các món đó vẫn ở bếp. Server kiểm tra chính xác danh sách đã xác nhận; có món mới/đã trả/đã hủy ở thiết bị khác thì từ chối và yêu cầu xác nhận lại. Lưu request_id và snapshot trong localStorage để thử lại an toàn sau mất phản hồi/reload, kể cả bàn đã đón lượt khách mới. Không xóa bộ nhớ trình duyệt khi còn yêu cầu chờ.

Bếp vuốt đơn sang trái hoặc phải đủ xa rồi thả để hoàn thành. Cuộn dọc, vuốt ngắn, nút bấm, lịch sử và vai trò phục vụ không hoàn thành bằng vuốt. Nút Xong vẫn dùng được bằng bàn phím. Đường đi hiển thị dạng Bàn 1 → Bàn 2 → Bàn 5; lưu phía server và không thêm mốc lặp khi thử lại cùng mã chuyển. Lịch sử trước nâng cấp được dựng từ các lần chuyển đã ghi theo thời điểm, lịch sử mới được nối nguyên tử cùng giao dịch chuyển bàn.

`test:table-cancel` kiểm tra nâng cấp trực tiếp từ 009 và sau 010, lịch sử/retry, hủy món không lý do, hủy bàn theo quyền/snapshot, giữ món đã trả/hóa đơn, đóng bàn, chống hủy nhầm lượt khách mới. `test:table-workflows` kiểm thử trình duyệt: không có ô lý do, đường đi 1→2→5, vuốt hai chiều, cuộn dọc/vuốt ngắn/lịch sử/phân quyền, pop-up hủy bàn, snapshot cũ và thử lại sau reload. SQL dùng PGlite, UI và thao tác chuột dùng Chromium/Supabase giả lập; chưa kiểm chứng nhiều phiên database đồng thời hay vuốt cảm ứng trên tablet thực tế.


## Thao tác bàn dạng pop-up và chuyển vào bàn có đơn

Chạy `supabase/migrations/012_table_actions_merge.sql` sau 011 trước khi triển khai bản mới. Chọn bàn → icon ba chấm cạnh tên bàn → pop-up Thao tác bàn: Chuyển bàn, Tách/gộp bill, Hủy cả bàn. Bấm × hoặc Escape để đóng; yêu cầu chờ vẫn lưu và có thể mở lại để thử cùng mã. Tách/gộp bill không còn nhập lý do. Các lý do trong nhật ký cũ vẫn được giữ.

Chuyển bàn có thể chọn bàn trống hoặc bàn đang có đơn. Bàn đang có đơn nhận thêm các bill riêng từ nguồn, tự đánh số tiếp theo và giữ các nhóm bill nguồn; nếu muốn chung một bill thì dùng Tách/gộp bill. Bàn nguồn trở thành trống. Món, giá, ghi chú, trạng thái/thứ tự bếp được giữ, các hóa đơn đã trả không thay đổi. Mỗi đơn giữ đường đi bàn riêng: đơn nguồn Bàn 1 → Bàn 2, đơn có sẵn ở đích vẫn Bàn 2; chuyển tiếp sang Bàn 5 sẽ lần lượt là Bàn 1 → Bàn 2 → Bàn 5 và Bàn 2 → Bàn 5.

Yêu cầu chuyển lưu phiên bàn đích đã chọn. Server khóa hai bàn theo thứ tự, kiểm tra phiên đích vẫn đúng và lưu kết quả trong một giao dịch. Bàn đích đổi lượt khách/đóng/chuyển trước khi xử lý sẽ bị từ chối để đồng bộ và chọn lại. Mất phản hồi/reload dùng cùng mã yêu cầu, không gộp lần hai hoặc ảnh hưởng lượt khách mới. Các yêu cầu gọi món, tách bill và thanh toán đã hoàn tất từ trước vẫn thử lại được bằng mã cũ; yêu cầu mới đối với phiên nguồn đã đóng bị từ chối.

Kiểm thử `test:table-merge` dùng PGlite cho gộp bàn, phân quyền, phiên đích thay đổi, bill riêng, hóa đơn cũ, retry, đường đi và thanh toán/bếp sau gộp. `test:table-actions` dùng Chromium với Supabase giả lập để kiểm tra icon/pop-up, bàn đích có đơn, thử lại sau reload, tách bill không lý do, đường đi riêng và kích thước điện thoại. Chưa thử nhiều phiên PostgreSQL đồng thời hoặc thiết bị cảm ứng thật.
