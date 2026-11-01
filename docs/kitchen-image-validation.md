# Kết quả kiểm chứng phiếu ảnh Bếp

Ngày 2026-11-01. Code nền main `6963f50`; bản làm việc nhánh `feat/kitchen-image-tickets` ở `/workspace/kitchen-image-tickets`. Kiểm chứng backend hiện có chỉ ở cục bộ; không chạy kiểm thử ghi trên Supabase production. Người dùng đã cho phép tiếp tục kiểm chứng và tích hợp bản thật; kết quả dịch vụ thực sẽ được bổ sung khi có kết nối quản trị.

## Đã chạy và đạt

| Kiểm tra | Phương thức / phạm vi |
|---|---|
| TypeScript + build Vite + PWA | `npm run build`; WASM không trong output frontend |
| Quyền/RLS/Storage policy, lượt tải, finalize, complete, cleanup, rollback | `tests/kitchen-images-sql.mjs`, PGlite với Auth/Storage schema giả; kiểm tra cả broad policy cũ không vượt restrictive guards |
| JWT/Owner gate, body có/không Content-Length, MIME, service-only attestation, fail upload, retry ACK | `tests/kitchen-images-edge.mjs`; HTTP giả lập, không thay thế kiểm chứng Edge Runtime |
| JPEG/PNG/WebP thật → WebP sạch, preview giữ tỷ lệ, file hỏng, vượt kích thước | Deno 2.5.6 + ImageMagick WASM 0.0.45; `tests/kitchen-images-decode.ts` |
| Hai kết nối cùng hoàn thành | PostgreSQL 17 Docker thật; hai transaction chồng nhau, khóa dòng giữ cùng actor/time và đúng một phiếu; schema Auth/Storage vẫn là fixture |
| Tính cách ly nghiệp vụ | Fixture 001–033 hiện có qua `tests/staff-table-cancellation-sql.mjs` + `tests/support/kitchen-image-sales-isolation.mjs`; snapshots 8 bảng và `revenue_report` trước/sau tạo/hoàn thành/rollback 034 giữ nguyên, bỏ riêng generated_at của báo cáo |
| Owner 1/3 ảnh, Kitchen/Waiter không upload, normal trước ảnh, FIFO, zoom/vuốt, ACK lỗi, retry/reload, lịch sử, offline | Chromium/Playwright `tests/kitchen-images-flow.mjs`, API giả |
| Lịch sử sau logout/login, Blob URL bị revoke lúc logout, không tải lại ảnh mỗi poll | Cùng bộ UI; tải qua Storage có Bearer JWT giả, kiểm tra request thực trên trình duyệt |
| Mobile/tablet/desktop | 375, 390, 768, 1280 px; không tràn ngang trong UI test mới |
| Bếp và chuông hiện có | `kitchen-tools-flow`, `kitchen-access-flow`, `kitchen-access-sql` |
| Thanh toán | `payment-layout-flow`, `payment-flow` |
| Báo cáo/xuất dữ liệu | `revenue-flow`, `revenue-export`, `management-024-sql` |
| Gọi thêm món từ đơn đã gửi | `reorder-saved-flow` |
| Chuẩn bị WASM | `npm run prepare:kitchen-image-wasm`, checksum asset khớp |
| Cấu hình function | Supabase CLI 2.58.5 đọc config thành công; `status` báo chưa có container project cục bộ, không deploy |

Các UI test cũ cố định cổng 5173 được chạy bằng bản tạm thay URL sang 5174, giữ nguyên assertions. Riêng `kitchen-access-flow` đã lỗi trên baseline trước tính năng: tên danh mục, bước Xem đơn, vị trí nút thanh toán/đồng bộ và thông báo trùng. Đã cập nhật test theo giao diện main hiện có và quyền hủy cả bàn từ 033; không sửa code nghiệp vụ để làm test qua. Bài đã chạy đạt sau cập nhật.

Decoder benchmark cục bộ, không đại diện Supabase Edge: ảnh WebP logo 256×256 khoảng 263 ms cả khởi tạo; JPEG trắng 2000×1500 khoảng 786 ms và 3200×2400 khoảng 1193 ms khi đã khởi tạo. Cần đo ảnh thật nhiều chi tiết, CPU/RSS và cold start trên Edge Runtime; không suy ra ảnh 8 triệu pixel chắc chắn đạt giới hạn CPU của dịch vụ.

## Còn phải kiểm chứng trước production

Đã thử dựng Supabase local đầy đủ, nhưng image Postgres Supabase vượt dung lượng khi giải nén bằng Docker vfs. Đã dừng, không có project Supabase local khởi động; dung lượng đã được giải phóng. PostgreSQL Alpine nhẹ dùng cho kiểm thử đồng thời riêng đã chạy được. Không có credential/quyền admin project Supabase thử nghiệm trong phiên này.

Vì vậy chưa xác nhận được:

- Auth thật + Storage API thật + PostgREST + Edge Function chạy chung trong Supabase.
- Bundle/static_files và giới hạn tài nguyên WASM trên Supabase Edge Runtime thực.
- Policy/schema thực tế của project thử nghiệm/production; ảnh private qua URL công khai/direct API trên dịch vụ thực.
- Đồng bộ và thao tác trên hai thiết bị vật lý, thư viện ảnh iPhone/Android, ảnh chụp lớn và mạng di động thật.
- Vercel preview/production hoặc PWA bản cài thật của tính năng mới.

**Chưa đủ căn cứ đề xuất production.** Theo `docs/kitchen-image-tickets.md`, chạy bảng kiểm trên project thử nghiệm riêng rồi ghi bổ sung kết quả. Không đổi kiểm thử giả thành lời khẳng định dịch vụ thật đã đạt.

## File bàn giao

- `src/main.tsx`: chỉ thêm import và vùng tích hợp; giữ JSX đơn thường.
- `src/kitchen-images/`: KitchenImageArea, KitchenImageUpload, KitchenImageTicket, KitchenImageZoom, PrivateImage, private-images, types, CSS.
- `supabase/migrations/034_kitchen_image_tickets.sql`: hai bảng, indexes, quyền, RLS, RPC, bucket và Storage guards.
- `supabase/rollbacks/034_kitchen_image_tickets.sql`: vô hiệu hóa, giữ dữ liệu.
- `supabase/functions/kitchen-image-upload/`: index, handler, decoder, deno.json/lock. Các asset JS/typings/WASM gzip tạo bằng script, không commit/không vào frontend.
- `supabase/config.toml`: cấu hình function và static WASM.
- `scripts/prepare-kitchen-image-wasm.mjs`: tải phụ thuộc đã ghim, kiểm checksum, tạo asset và NOTICE giấy phép.
- `tests/kitchen-images-{sql,edge,flow,concurrency}.mjs`, `tests/kitchen-images-decode.ts`, helper sales-isolation và tích hợp vào test 033.
- `tests/kitchen-access-flow.mjs`: sửa selectors/điều hướng lỗi thời, thêm POS_TEST_URL.
- `.gitignore`, `package.json`: loại asset phát sinh và thêm lệnh chuẩn bị/kiểm thử.
- Hai tài liệu `docs/kitchen-image-tickets.md`, `docs/kitchen-image-validation.md`.

## Sửa lỗi deploy HTTP 413

Báo cáo từ máy Windows: Management API trả `request entity too large`. Đã thay asset WASM thô 15.425.791 byte bằng gzip 5.320.849 byte; không import gói npm đầy đủ vào Edge graph. JS/typings/NOTICE được chuẩn bị cục bộ, từng file kiểm SHA-256; tổng bộ xử lý 5,89 MiB và có chốt ngân sách 6 MiB. Xóa asset WASM thô cũ để tránh gửi trùng. Runtime giải nén và kiểm lại SHA-256 trước khởi tạo; không giảm kiểm tra ảnh hoặc phân quyền.

Đã kiểm tra chuẩn bị gói mới, Deno check, giải mã JPEG/PNG/WebP thật, ảnh lỗi/giới hạn pixel và Edge handler. Cần người dùng deploy lại để xác nhận API Supabase chấp nhận gói mới; chưa ghi nhận deploy thành công.

## Lỗi 413 tiếp tục sau gói gzip — phương án hiện tại

Người dùng vẫn nhận HTTP 413 khi deploy gói 5,89 MiB qua Management API. Chưa có số liệu kích thước request thực hoặc giới hạn cụ thể từ API, nên không khẳng định giới hạn là bao nhiêu. Đã bỏ hoàn toàn WASM khỏi static deploy assets, chỉ đóng gói JS/typings/NOTICE đã kiểm hash, tổng 0,71 MiB. Script xóa cả hai file WASM thô/gzip cũ.

`wasm-loader.ts` chỉ tải URL cố định phiên bản 0.0.45 từ cdn.jsdelivr.net, timeout 20 giây, không credentials/headers người dùng, cấm redirect, đọc stream giới hạn chính xác 15.425.791 byte và xác minh SHA-256 trước khi khởi tạo. Isolate giữ thư viện đã khởi tạo; nếu khởi tạo lỗi thì cho phép thử lại. Không bỏ kiểm tra định dạng ảnh hoặc quyền upload. Giới hạn mới: lần tải đầu cần CDN sẵn sàng và outbound HTTPS; ảnh người dùng không được gửi lên CDN.

Đã chạy đạt: chuẩn bị gói 0,71 MiB; Deno check; Deno tải thực từ CDN và giải mã JPEG/PNG/WebP cùng kiểm tra ảnh hỏng/kích thước; unit test loader chặn status lỗi, thiếu/thừa byte, sai hash và kiểm tra không gửi credentials. Edge handler test vẫn đạt. Chưa xác nhận deploy Supabase thành công; cần người dùng triển khai gói mới và đối chiếu endpoint.
