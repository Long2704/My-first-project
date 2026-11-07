# Bún Riêu Góc Phố POS

Ứng dụng quản lý bán hàng cho quán: gọi món, gửi bếp, thanh toán và xem doanh thu. Dùng trên điện thoại, máy tính bảng hoặc máy tính; có thể cài ra màn hình chính.

**[Mở ứng dụng](https://bunrieugocpho.vercel.app)** · [Hướng dẫn cài app](docs/pwa-home-screen.md) · [Tài liệu kỹ thuật](docs/)

## App có những gì?

- **Phục vụ:** sơ đồ bàn, tìm bàn, chọn món, ghi chú và gọi thêm món.
- **Bếp:** nhận đơn theo thời gian, báo đơn mới, hoàn thành đơn; hỗ trợ phiếu ảnh theo quyền.
- **Thanh toán:** tiền mặt/chuyển khoản, tiền thừa, tách/gộp bill, xem và in lại hóa đơn.
- **Quản lý:** thực đơn, bàn, nhân viên, báo cáo doanh thu và xuất CSV/Excel.

Các chức năng hiển thị theo quyền của tài khoản **Owner (chủ quán), Phục vụ hoặc Bếp**. Số bàn và giá món lấy từ dữ liệu của quán.

## Dùng hằng ngày

1. Đăng nhập → **Phục vụ** → chọn bàn hoặc **Mang về**.
2. Chọn món, nhập ghi chú nếu cần → **Gửi bếp**.
3. Tại màn hình **Bếp**, hoàn thành phiếu bằng nút **Xong** hoặc vuốt.
4. Khách trả tiền → mở bàn → **Thanh toán** → chọn tiền mặt hoặc chuyển khoản.
5. Chủ quán mở **Báo cáo doanh thu**, chọn ngày và giờ Việt Nam rồi xem hoặc xuất báo cáo.

**Khi mất mạng hoặc chưa rõ thao tác đã thành công:** dùng nút thử lại của yêu cầu đang chờ. Không thu tiền lần nữa hoặc xóa dữ liệu trình duyệt khi chưa xác nhận kết quả.

**Khi có bản cập nhật:** hoàn tất thao tác đang chờ, gửi hoặc chọn lại món chưa gửi; đóng tất cả cửa sổ POS và app đã cài, rồi mở lại.

## GitHub, Supabase và Vercel dùng để làm gì?

| Dịch vụ | Vai trò |
| --- | --- |
| **GitHub** | Lưu mã nguồn và lịch sử thay đổi của app. |
| **Supabase** | Lưu tài khoản, thực đơn, đơn hàng, hóa đơn và ảnh; kiểm tra quyền truy cập. |
| **Vercel** | Triển khai website để nhân viên mở và sử dụng. |

## Chạy dự án trên máy tính

Phần này dành cho người sửa mã nguồn. Người dùng app chỉ cần mở đường dẫn phía trên.

Cần **Node.js 22.12+ hoặc Node.js 24**, npm và Git.

```sh
git clone https://github.com/Long2704/bun-rieu-goc-pho-pos.git
cd bun-rieu-goc-pho-pos
npm ci
```

Sao chép `.env.example` thành `.env.local`, rồi điền hai giá trị từ Supabase:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Không ghi đè file cấu hình đã có. Chỉ dùng publishable key; không đưa secret key hoặc `service_role` vào frontend hay GitHub.

```sh
npm run dev
```

Mở địa chỉ mà terminal hiển thị. Trên Windows PowerShell, nếu gặp lỗi chặn `npm.ps1`, dùng `npm.cmd` thay cho `npm`.

## Triển khai và kiểm tra

**Vercel:** chọn framework **Vite**, lệnh build `npm run build`, thư mục đầu ra `dist`. Khai báo hai biến môi trường Supabase ở trên rồi triển khai.

**Supabase:** thay đổi database và Edge Function được áp dụng riêng; deploy Vercel không tự chạy SQL. Khi nâng cấp, kiểm tra migration đã áp dụng và chỉ chạy phần còn thiếu. Kho mã có các migration kế thừa schema nền, nên không coi đây là bộ cài database mới hoàn toàn tự động.

Một số lệnh kiểm tra:

```sh
npm run build
npm run test:sql
npm run test:weekly-reports
```

Các bài kiểm thử trình duyệt nằm trong [tests/](tests/), cần dev server và Chromium; cấu hình địa chỉ thử theo từng bài. Test dùng dữ liệu giả không thay thế kiểm tra trên thiết bị của quán.

## Hướng dẫn chi tiết

| Bạn cần tìm | Tài liệu |
| --- | --- |
| Cài app lên điện thoại, nhận cập nhật | [PWA và màn hình chính](docs/pwa-home-screen.md) |
| Thanh toán tiền mặt/chuyển khoản | [Giao diện thanh toán](docs/payment-interface.md) |
| Gọi thêm từ món đã gửi | [Gọi thêm món](docs/reorder-from-saved.md) |
| Tài khoản và tên đăng nhập | [Quản lý tài khoản](docs/username-accounts-029.md) |
| Quên mật khẩu | [Khôi phục mật khẩu](docs/password-recovery.md) |
| Báo cáo có giờ–phút–giây | [Bộ chọn giờ](docs/compact-report-clock.md) |
| Excel theo khung giờ và dọn lịch sử | [Báo cáo và lịch dọn](docs/ios-seconds-excel-weekly-retention.md) |
| Phiếu ảnh hoàn thành được xóa | [Ảnh tạm cho bếp](docs/temporary-kitchen-images-and-trial-reset.md) |
| Giao diện và hình nền | [Bố cục kem–cam](docs/reference-restaurant-layout.md) |
| Chi tiết các phiên bản cũ | [README cũ để tra cứu](docs/legacy-readme.md) |

**Lưu dữ liệu:** chức năng dọn lịch sử cần được bật riêng. Khi bật lịch hằng tuần với chính sách 7 ngày, các giao dịch đủ điều kiện cũ sẽ bị xóa khỏi app và báo cáo; cần sao lưu dữ liệu muốn giữ. Sửa README này không bật lịch dọn hoặc xóa dữ liệu.

Một số tài liệu kỹ thuật mô tả thời điểm phát triển của từng phiên bản; khi nâng cấp, đọc ghi chú của phiên bản mới hơn.
