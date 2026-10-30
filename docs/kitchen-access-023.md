# Kitchen — bước 023

## Đã làm

- Kitchen giữ màn hình Bếp khi đăng nhập, thêm nút Phục vụ.
- Phục vụ/Kitchen tạo đơn, xem cả món nước, chuyển bàn, tách/gộp bill và thanh toán.
- Kitchen/Owner hoàn thành đơn bếp; Waiter không được hoàn thành bếp.
- Chuyển bàn kiểm tra quyền ở cả wrapper và hàm nội bộ; hàm nội bộ vẫn không được
  gọi trực tiếp từ tài khoản ứng dụng.
- Kitchen không có mục Hóa đơn của tôi; vẫn xem xác nhận hóa đơn ngay sau thanh toán.
  Waiter có mục Hóa đơn của tôi, chỉ hiển thị hóa đơn do mình thanh toán.
  RLS áp dụng cả bảng bills, bill_items và bill_orders; Owner đọc toàn bộ.
- Không mở quyền sửa giá, báo cáo, nhật ký quản trị, hủy món/bàn hoặc giảm giá
  cho Kitchen/Waiter. Không thêm ca làm hoặc thay dữ liệu lịch sử.
- UI nhận quyền từ get_my_access(), không dùng metadata/JWT tự khai vai trò.
  Mỗi lần đồng bộ dùng một RPC lấy hồ sơ/quyền, không gọi riêng từng quyền qua mạng.
- Khi phát hiện khóa tài khoản, UI ngừng hiển thị dữ liệu nghiệp vụ, cho đăng xuất,
  giữ mã yêu cầu chờ trong localStorage để đối chiếu/thử lại sau mở khóa.
  DB từ chối thao tác ngay theo trạng thái hồ sơ; UI phát hiện khi đồng bộ, thường
  trong chu kỳ 5 giây, không phải cơ chế khóa tức thì ở frontend.

## Phạm vi kiểm chứng

Đã kiểm thử PGlite với auth.uid() giả lập và Playwright với toàn bộ mạng Supabase
được giả lập. Không có kết nối Supabase Dashboard/DB của người dùng trong môi trường
làm việc này; không thay đổi tài khoản TEST-K01 thực tế hoặc production.
Chưa chứng minh Auth thật, cấu hình triển khai hoặc hai kết nối đồng thời.

```sh
npm ci
npm run build
npm run test:permissions
npm run test:payment-permissions
npm run test:kitchen-access
npm run test:kitchen-access-ui
```

Test UI cần Vite đang chạy với cấu hình giả bên dưới, Chromium và Playwright.
Không dùng thông tin production để chạy test. Có thể đặt CHROMIUM_PATH nếu cần.

```dotenv
VITE_SUPABASE_URL=https://uiwzinyckukaqlbznnam.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=mock-browser-test-key
```

Các test SQL không dùng biến kết nối Supabase hoặc sửa DB bên ngoài. Test mới
kiểm tra khóa/mở Kitchen trên cùng claim người dùng, kể cả replay thanh toán,
tách bill/chuyển bàn/hoàn thành bếp và RLS. Test UI kiểm tra mất phản hồi thanh toán,
khóa/mở tài khoản không mất mã chờ, Kitchen không có mục lịch sử hóa đơn nhưng
vẫn xem xác nhận sau thanh toán, vuốt bếp và màn hình điện thoại.
Các test UI cũ được đổi fixture để trả quyền từ RPC mới và kỳ vọng Waiter được
thanh toán/chuyển/tách theo yêu cầu mới; không bỏ các kịch bản kiểm thử cũ.

## Áp dụng trên máy Windows và project thử nghiệm

1. Giữ bản mã nguồn đang chạy trong một thư mục riêng để có thể quay lại.
2. Project thử nghiệm đã áp dụng 017–022: chỉ chạy toàn bộ
   `supabase/migrations/023_kitchen_service_access.sql` một lần trong SQL Editor.
   Không chạy file rollback hoặc chạy lại 017–022.
3. Cập nhật `src/main.tsx`, `src/PaymentPanel.tsx`, `src/InvoiceHistory.tsx` cùng nhau.
   Bản frontend mới cần get_my_access() trong migration 023.
4. Giữ .env.local trỏ project thử nghiệm; không thay Vercel hoặc .env production.
5. Chạy npm run build rồi npm run dev. Dùng các tài khoản thử đã tạo để xem lại
   giao diện trên Supabase thật trước khi cân nhắc production.

Các file 017–022 trong mã nguồn ghi lại các bước đã thực hiện thủ công trước đó,
không được áp dụng lại trên project thử nghiệm hiện tại.

## Quay lại

Dừng app mới, khôi phục ba file frontend cũ và dùng
`supabase/rollbacks/023_kitchen_service_access.sql` trên project thử nghiệm.
Rollback khôi phục cả các policy đọc rộng trước đó; chỉ dùng trong quá trình thử,
không coi đó là phương án bảo mật cho production. Không xóa đơn hoặc hóa đơn.
Không gỡ 021/022 khi 023 còn sử dụng chúng.

## Còn lại trước production

- Quản lý nhân viên/Edge Function tạo tài khoản chưa được xây trong bước này.
- Việc chuyển toàn bộ vai trò thu_ngan cũ và tất cả RPC sang quyền tập trung
  chưa hoàn tất; không xóa tài khoản hoặc cột cashier_id lịch sử.
- Policy đọc đơn/phiên cũ vẫn rộng: cần thiết kế giới hạn lịch sử để không cho
  nhân viên tổng hợp tài chính qua dữ liệu đơn, dù đã giới hạn hóa đơn và báo cáo.
- Hệ thống vẫn có cooking/done; chưa thêm trạng thái chờ/đang làm mới.
- In hóa đơn vẫn được giữ ở bước này; loại bỏ UI in là một thay đổi riêng.
- Cần backup có Auth phù hợp, kiểm thử Supabase thật, đồng thời và phê duyệt trước
  khi migration/deploy production.
