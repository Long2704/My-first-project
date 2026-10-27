# Bún Riêu Góc Phố POS

Giai đoạn hiện tại: đăng nhập Supabase bằng email/mật khẩu, đọc hồ sơ vai trò và thực đơn đang bán từ database, giỏ chọn thử và đăng xuất. Chưa có lưu đơn, thanh toán, realtime hay hỗ trợ PWA/offline. Không dùng bản này để bán hàng thực tế.

## Chạy phát triển

Yêu cầu Node.js 22.12+ hoặc 24, npm.

```sh
npm ci --cache /tmp/bun-rieu-npm-cache
cp .env.example .env.local
npm run dev
```

Điền Project URL và publishable key vào `.env.local`. Không sử dụng service_role hay secret key. Không commit tệp chứa thông tin kết nối cục bộ.

```sh
npm run build
```

## Vercel

Framework: Vite. Build command: `npm run build`. Output directory: `dist`.
Thêm biến VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY trong cấu hình dự án Vercel rồi triển khai lại. Các biến VITE_ được đưa vào frontend; không đặt bí mật vào đó.

Schema profiles và menu_items được thiết lập qua SQL Editor theo hướng dẫn trong cuộc trò chuyện. Tài khoản phải có hồ sơ và vai trò hợp lệ. Kiểm thử thủ công: đăng nhập sai, đăng nhập chủ quán, đọc menu ba nhóm (6/7/5 món), thử chọn món, đăng xuất và tải lại. Chưa xác minh đăng nhập thực tế bằng tài khoản người dùng. Các bước tiếp theo: phục vụ/bếp, thanh toán và kiểm thử quyền.
