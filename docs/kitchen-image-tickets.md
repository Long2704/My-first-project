# Phiếu ảnh Bếp — bàn giao thử nghiệm

Nhánh cục bộ: `feat/kitchen-image-tickets`. Nền: main `6963f5060112bfd38ea866edd3dcc182e294faa4`.
Giai đoạn đầu chỉ viết mã và kiểm thử cục bộ theo yêu cầu. Ngày 2026-11-01, người dùng tiếp tục cho phép tự kiểm chứng và tích hợp bản thật. Quy trình hiện tại: công bố nhánh/PR và kiểm tra preview, xác minh backend thử nghiệm, sau đó mới áp dụng backend và merge production. Chưa có kết nối Supabase quản trị trong môi trường; chưa chạy SQL hoặc deploy function vào project thật.

## Chức năng và dữ liệu

Owner vào Bếp → **Tải ảnh lên**, chọn một hoặc nhiều ảnh rồi **Gửi ảnh** cho từng ảnh. Mỗi ảnh tạo một phiếu riêng. Trạng thái chờ/đang tải/đã tải/lỗi tách riêng. Khi lỗi, giữ ảnh và dùng **Thử lại**; tải lại trang thì chọn lại đúng ảnh để dùng lại mã yêu cầu cũ. Khi server đã xác nhận thành công, chọn lại ảnh đó trong một lượt mới có thể tạo phiếu mới theo chủ ý.

Đơn thường giữ nguyên và luôn đứng trước phiếu ảnh trong danh sách. Phiếu ảnh đang làm xếp `created_at, id` tăng dần; lịch sử xếp thời điểm hoàn thành giảm dần. Tải 40 phiếu/lần, **Xem thêm phiếu ảnh** để tăng số lượng. Lịch sử ảnh không phụ thuộc bàn mở. Owner/Kitchen chạm ảnh hoặc **Xem ảnh lớn**, vuốt ngang hai chiều hoặc bấm **Xong**. Phiếu chỉ rời hàng chờ sau ACK hợp lệ. Hai kết nối hoàn thành cùng phiếu nhận cùng người/thời điểm đầu tiên.

JPG/PNG/WebP đầu vào tối đa 5 MiB; máy chủ kiểm tra magic bytes/MIME, giải mã thật bằng ImageMagick WASM 0.0.45, giới hạn 4096 px/chiều và 8 triệu pixel. Đọc khung hình đầu, áp dụng hướng EXIF, xóa metadata và tạo WebP sạch cùng ảnh xem trước cạnh dài tối đa 640 px, giữ tỷ lệ. File lỗi/ảnh lớn không tạo phiếu. WASM chỉ nằm trong Edge Function, không vào JS giao diện. Điện thoại chụp ảnh vượt giới hạn pixel cần giảm kích thước trước khi gửi; cần đánh giá trải nghiệm này trong thử nghiệm thiết bị thật.

### Bảng, quyền và Storage

Migration mới: `supabase/migrations/034_kitchen_image_tickets.sql`, sau 033; không sửa migration cũ.

- `kitchen_image_tickets`: mã yêu cầu unique, ảnh/preview, kích thước, trạng thái, người và thời điểm tạo/hoàn thành. `upload_id` unique.
- `kitchen_image_uploads`: lượt tải có thời hạn, hash nội dung, người tạo, đường dẫn bất biến và trạng thái xử lý. Mỗi lần thử hết hạn có đường dẫn riêng để không ghi đè.
- Bucket `kitchen-ticket-images`: **private**, chỉ WebP đã xử lý, tối đa 5 MiB.

| Quyền | Owner | Kitchen | Waiter/ẩn danh/khóa/phiên cũ |
|---|---|---|---|
| Tải ảnh qua Edge | Có | Không | Không |
| Đọc phiếu/file đã thành phiếu | Có | Có | Không |
| Hoàn thành | Có | Có | Không |
| Ghi trực tiếp bảng hoặc Storage từ trình duyệt | Không | Không | Không |

`kitchen_images.read/upload` mở rộng `has_permission/get_my_access` theo ma trận 033; giữ toàn bộ quyền cũ. Hoàn thành cần cả `kitchen_images.read` và `kitchen.complete`. Vẫn kiểm tra active, đổi mật khẩu bắt buộc và `staff_session_current`. Các bảng bật RLS, trình duyệt không có grant ghi. Metadata verified chỉ service role phía Edge được chứng nhận; reserve/finalize dùng chính JWT người gọi và `auth.uid()` nên không giả người tạo. Complete khóa dòng và lấy người hoàn thành từ `auth.uid()`.

Migration dừng nếu Storage objects/buckets không bật RLS. Policy restrictive chặn trình duyệt đổi bucket thành public hoặc xóa/thay bucket kể cả có broad bucket policy.

Storage chỉ cho đọc object gắn với phiếu hợp lệ và quyền đọc hiện tại. Các policy restrictive bổ sung chặn broad policy cũ mở nhầm bucket này; vẫn cần kiểm kê policy trên project thử nghiệm. Upload từ Owner đi qua Edge xác minh JWT tại Auth và quyền tại DB, sau đó service role mới ghi ảnh đã xử lý. Không có service key trong frontend. Không dùng public URL hoặc signed URL; tải file có JWT qua Storage API (`cache: no-store`), chuyển thành Blob URL trong bộ nhớ. Không đưa ảnh/token vào localStorage, CacheStorage hoặc PWA cache.

Frontend chỉ lưu UUID/hash theo người dùng trong localStorage để retry, không lưu byte ảnh. Ảnh ngoài vùng nhìn giải phóng tham chiếu; cache tối đa 48 ảnh/32 MiB đối với mục không còn dùng, có thể vượt tạm thời bởi các ảnh đang hiển thị. Cache hủy khi rời màn hình, đăng xuất hoặc mất quyền. Poll metadata riêng mỗi 5 giây lúc tab hiện, không ghép vào Promise.all của đơn thường; lỗi ảnh không chặn đơn thường. Giữ nguyên input/logic chuông `KitchenTools`.

### Luồng giao dịch và dọn ảnh dở

1. Edge xác minh JWT và quyền Owner trước đọc body. Chặn body quá lớn cả khi thiếu Content-Length.
2. Máy chủ hash file. Reserve RPC khóa theo request UUID, kiểm tra cùng người/hash. Phiếu đã tồn tại trả lại phiếu cũ. Lượt đang xử lý từ chối tạo lượt trùng.
3. Giải mã, ghi full/preview với `x-upsert=false`; không cho frontend tự chọn path.
4. Service-only verify ghi metadata đã xác minh. Finalize bằng JWT Owner kiểm tra quyền lại, khóa request/lượt tải và chỉ tạo phiếu từ lượt verified chưa hết hạn.
5. Nếu ACK mất sau commit, gửi lại cùng UUID/hash trả phiếu cũ. Nếu mới tải một phần, không có phiếu; sau 2 phút có thể thử lượt mới với cùng UUID, path khác. Nếu quyền bị thu hồi giữa chừng, finalize thất bại và ảnh nằm trong ledger chờ dọn.
6. Owner mở **Ảnh tải dở → Dọn ảnh tải dở**. Chỉ claim tối đa 10 lượt hết hạn hơn 1 giờ/đợt và không được tham chiếu bởi phiếu. Claim khóa dòng, chuyển sang cleaning để finalize không chạy lại; Edge xóa qua Storage API, thành công mới mark cleaned. Lỗi delete vẫn giữ cleaning và có thể thử lại. Không xóa ảnh của phiếu đang làm hoặc lịch sử. Không có cron hay tự xóa lịch sử.

## Cách ly nghiệp vụ

Không ghi `orders`, `order_items`, `table_sessions`, `bills`, `bill_items`, bảng thanh toán, audit bán hàng hoặc trạng thái bàn. Không sửa RPC thanh toán, báo cáo, xuất CSV, `order-model`, `KitchenTools`, `SwipeOrderCard` hoặc cấu hình PWA. Truy vấn `revenue_report` hiện tại đọc `bills/bill_items`, không đọc bảng phiếu ảnh.

Test fixture đầy đủ 001–033 tạo và hoàn thành phiếu ảnh rồi rollback 034: snapshots của 8 bảng nghiệp vụ và `revenue_report` (bỏ timestamp sinh báo cáo) giữ nguyên. Đây là chứng cứ trong môi trường kiểm thử, không phải chứng nhận production.

## Chạy kiểm tra an toàn

```sh
npm ci
npm run prepare:kitchen-image-wasm
npm run build
npm run test:kitchen-images
# Deno 2; đọc asset WASM đã chuẩn bị
DENO_TLS_CA_STORE=system deno check --config supabase/functions/kitchen-image-upload/deno.json supabase/functions/kitchen-image-upload/index.ts
DENO_TLS_CA_STORE=system deno test --allow-read --config supabase/functions/kitchen-image-upload/deno.json tests/kitchen-images-decode.ts
# PostgreSQL Docker cục bộ, tự dọn container, không mở cổng
npm run test:kitchen-images-concurrency
```

UI test dùng Vite `http://localhost:5174`, publishable key giả, toàn bộ URL Supabase bị Playwright intercept:

```sh
VITE_SUPABASE_URL=https://uiwzinyckukaqlbznnam.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=mock-public-key npm run dev -- --port 5174
npm run test:kitchen-images-ui
POS_TEST_URL=http://localhost:5174 node tests/kitchen-access-flow.mjs
```

`POS_TEST_URL` có thể đổi cổng cho UI test mới. Các test cũ cố định 5173 có thể chạy Vite tại 5173 hoặc tạo bản chạy tạm thay URL; không chạy chúng với API thật. Chi tiết kết quả: `docs/kitchen-image-validation.md`.

## Triển khai trên project thử nghiệm riêng — chưa thực hiện

1. Tạo/chọn Supabase **thử nghiệm riêng** có cấu trúc/permissions hiện tại đến 033. Nếu clone dữ liệu, dùng dữ liệu giả, không copy tài khoản/mật khẩu/token khách thật. Xác nhận bucket chưa có, bảng/hàm cùng tên chưa có; kiểm kê policy `storage.objects`, table grants, Auth/session và preflight `has_permission/get_my_access`. Không suy ra production giống fixture.
2. Lưu snapshot schema/policies/grants và số liệu nghiệp vụ thử nghiệm. Mở SQL Editor của **project thử nghiệm**, chạy nguyên `034_kitchen_image_tickets.sql` trong transaction. Bucket trùng tên làm migration fail, không ép chuyển bucket đang dùng thành public/private. Không chạy tự động `db push` vào project thật.
3. Chạy `npm run prepare:kitchen-image-wasm`: tải đúng bản npm, kiểm SHA-256 file WASM trước khi chép vào Edge. Asset và NOTICE giấy phép được tạo cùng nhau, gitignore; không đưa vào `public/`. Deno lock ghim integrity phụ thuộc. Cấu hình function nằm ở `supabase/config.toml` có `static_files` để đóng gói WASM.
4. Khi kết nối project thử nghiệm sẵn sàng: dùng CLI deploy riêng `kitchen-image-upload` với `--project-ref <TEST_PROJECT_REF>`, giữ verify_jwt. URL/public/service-role lấy từ biến tích hợp sẵn của Supabase Function, không thêm service key ở Vercel. Xác minh npm/WASM được bundle, cold start, RSS/CPU và ảnh lớn trên **Supabase Edge Runtime**, không chỉ Deno thường. Nếu CLI không đóng gói asset, dừng để sửa bundle; không bỏ kiểm tra ảnh.
5. Build frontend với URL/publishable key **project thử nghiệm** rồi chạy cục bộ hoặc môi trường preview được duyệt riêng. Nhánh/PR có thể tạo Vercel preview theo yêu cầu tích hợp mới; preview frontend không thay thế kiểm chứng backend thử nghiệm.
6. Tạo tài khoản giả Owner, Kitchen, Waiter; thử đủ bảng kiểm dưới đây bằng hai trình duyệt/thiết bị, ghi kết quả và log đã che token. Chỉ đề xuất production khi các bước thực còn thiếu đều đạt.

### Bảng kiểm bằng tài khoản thử nghiệm

- Owner: 1 ảnh → 1 phiếu; 3 ảnh → 3 phiếu. Thử JPG/PNG/WebP, ảnh hỏng, sai MIME, >5 MiB, vượt pixel, mạng đứt giữa ảnh/preview và mất ACK sau finalize. Retry UUID không tăng số phiếu. Khóa Owner giữa upload/finalize → không có phiếu.
- Kitchen: xem ảnh và full ảnh; không có nút tải. Gọi Edge/Storage upload trực tiếp vẫn bị chặn.
- Waiter: đơn bếp thường hoạt động; không thấy phiếu ảnh. Thử select bảng, download private, public object URL, API upload/complete: bị từ chối/không có dữ liệu.
- Ẩn danh, bị khóa, bắt đổi mật khẩu, phiên đã thu hồi: không đọc/tạo/hoàn thành được. Xác nhận thu hồi quyền làm màn hình/cache đóng trong chu kỳ quyền hiện có.
- Owner và Kitchen ở hai thiết bị: nhận phiếu sau poll; đơn thường luôn trước ảnh, ảnh FIFO; đồng thời Xong trả cùng actor/time; máy còn lại cập nhật sau poll. Chạm, phím Enter, kéo ngang ngắn, cuộn dọc, vuốt dài hai chiều, pointercancel không lẫn zoom/complete.
- Lịch sử: ảnh sau hoàn thành vẫn mở được sau reload, đăng xuất/đăng nhập và đóng mọi bàn. Kiểm tra trên mobile, tablet, desktop, ảnh ngang/dọc, zoom/Escape/khôi phục focus.
- Cleanup: ledger tải dở cũ bị xóa; phiếu đã tạo và ảnh lịch sử giữ nguyên; race cleanup/finalize không tạo phiếu trỏ file đã xóa. Kiểm tra các broad policy cũ không bypass bucket mới.
- Đối chiếu doanh thu, số lượng món, invoices, CSV, bàn, bếp thường và chuông trước/sau thao tác ảnh. Kiểm tra PWA không cache Storage/authenticated response. Kiểm tra cache không download lại file mỗi 5 giây.

## Rollback an toàn

1. Dùng frontend trước nhánh này (hoặc gỡ tích hợp `KitchenImageArea`) và dừng function tải ảnh riêng sau khi xác nhận người dùng ngừng tải. Không thay app đang dùng khi chưa được duyệt.
2. Trên đúng môi trường, chạy `supabase/rollbacks/034_kitchen_image_tickets.sql`. Nó khôi phục hai hàm quyền đúng 033, thu hồi execute các RPC mới; policy guard vẫn giữ, quyền ảnh trả false.
3. Giữ nguyên bucket private, bảng, ledger, ảnh lịch sử. Không drop/truncate/delete dữ liệu; không khôi phục toàn bộ backup đè dữ liệu bán hàng mới. Ghi lại version; nếu migration quyền mới hơn 034 đã áp dụng, cần hợp nhất quyền thay vì dùng nguyên rollback cũ.
4. Rollback này là vô hiệu hóa, không hỗ trợ chạy lại migration CREATE nguyên vẹn. Muốn bật lại, tạo migration tiếp theo chỉ khôi phục quyền/grants sau khi kiểm tra schema, không xóa bảng để chạy lại 034.
