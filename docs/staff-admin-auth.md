> Tài liệu giai đoạn xác thực ban đầu. Backend mới có tạo nhân viên được mô tả tại employee-creation-027.md.

# staff-admin — bước đầu: xác minh Owner

## Mục tiêu

Chuẩn bị lớp kiểm tra quyền trước khi thêm API tạo nhân viên. Bản này chỉ hỗ trợ
POST với body {"action":"check_access"}. Không có create/update/delete/reset,
không tạo tài khoản, không sửa database và không gửi email.

Code là một file TypeScript độc lập tại supabase/functions/staff-admin/index.ts,
không cần cài thư viện hoặc import từ Internet. Supabase Edge Runtime chạy bằng
Deno. Kiểm thử cục bộ dùng Web Request/Response/fetch của Node với fetch giả lập,
không phải bằng chứng function đã deploy hoặc gateway Supabase thật đã hoạt động.

## Kiểm tra quyền

1. Chỉ nhận POST và OPTIONS phục vụ CORS, yêu cầu Bearer JWT cho POST.
2. Gọi /auth/v1/user bằng JWT đó để Auth kiểm chứng, không tự decode rồi tin token.
3. Gọi get_my_access() bằng CHÍNH JWT đó, dùng hàm đã có từ migration 023.
4. Chỉ chấp nhận role chu, is_active=true và quyền employees.manage.
5. Không tin role/user_id trong body hoặc metadata phía frontend.

POST không đăng nhập/JWT không hợp lệ bị 401; không phải Owner hoặc Owner khóa
bị 403. Lỗi Auth/database/kết nối thất bại đóng quyền bằng 503. Không trả lỗi nội
bộ, token, email hay API key về client. CORS * không thay thế xác thực; không có
request ghi nào trong phiên bản này. Không dựa vào gateway JWT làm lớp duy nhất.

Chỉ dùng biến mặc định SUPABASE_URL và SUPABASE_ANON_KEY (khóa public, server
vẫn lấy quyền từ JWT người gọi). POS_PUBLISHABLE_KEY là fallback nếu môi trường
không có key mặc định; chỉ cấu hình trong Dashboard nếu thật sự thiếu, không
gửi key vào chat. Không cần SUPABASE_SERVICE_ROLE_KEY ở giai đoạn này.

## Cài trên project thử nghiệm bằng Dashboard

1. Đang ở project THỬ NGHIỆM → Edge Functions → Deploy a new function → Editor.
2. Đặt tên staff-admin. Nếu đã có function cùng tên, sao lưu code cũ trước.
3. Thay TOÀN BỘ code mẫu bằng nội dung index.ts, không thêm key/password vào code.
4. Deploy function này trên project thử nghiệm. Không thay Vercel hoặc production.
5. Chưa dùng nút Test của Dashboard với key mặc định; cần gọi bằng phiên đăng nhập
   Owner trong app. Nếu chưa deploy được, gửi lỗi đã che thông tin nhạy cảm.

Chưa cần SQL mới hoặc thay frontend. get_my_access() đã có ở project thử nghiệm.
Supabase tự cung cấp URL/key mặc định; không yêu cầu người dùng đưa secret vào chat.

## Gọi từ app ở bước kiểm tra sau deploy

Trong Console localhost đã đăng nhập Owner, dùng client hiện có để tự đính kèm
JWT. Không sao chép access token hoặc key ra màn hình.

```js
const staffAdminClient = await import('/src/supabase.ts');
const staffAdminResult = await staffAdminClient.supabase.functions.invoke(
  'staff-admin', {body:{action:'check_access'}}
);
console.log({data:staffAdminResult.data,error:staffAdminResult.error?.message??null});
```

Owner hợp lệ: data.ok=true, error=null. Waiter/Kitchen: HTTP 403; cần đọc thông báo
HTTP bằng context Response nếu SDK chỉ báo non-2xx. Không gọi action tạo tài khoản
vì bản này chưa có. Không dùng thông tin đăng nhập tài khoản thật của quán để thử.

Nếu gateway báo Invalid JWT với token hợp lệ, có thể project dùng signing key mới
mà gateway legacy không hỗ trợ. Chỉ khi đã xác nhận đang dùng nguyên code kiểm tra
Auth ở trên, có thể tắt Verify JWT (legacy) RIÊNG staff-admin trên project thử nghiệm
rồi kiểm tra lại. Không tắt xác thực cho function khác hoặc thay settings production.
Không bỏ /auth/v1/user/get_my_access để xử lý lỗi JWT.

## Kiểm thử cục bộ

node tests/staff-admin-auth.mjs

Typecheck riêng file Edge bằng TypeScript với ES2022/DOM, không thuộc Vite frontend.
Test: Owner hợp lệ; thiếu/sai JWT; Auth lỗi; database lỗi; profile thiếu; role giả;
Waiter/Kitchen; Owner khóa trên cùng JWT; permissions sai; CORS; action chưa hỗ trợ;
không lộ token/key; mọi fetch chỉ là Auth GET và get_my_access POST.

## Quay lại

Function mới chưa được UI gọi tự động, không có dữ liệu ghi. Có thể xóa riêng
staff-admin trong Edge Functions của project thử nghiệm để quay lại, hoặc phục hồi
code cũ nếu đã tồn tại. Không xóa database, tài khoản hoặc danh sách nhân viên.
Không có công cụ deploy/connection Supabase được dùng trong phiên lập trình này.

## Phần tiếp theo chưa làm

Tạo tài khoản Waiter/Kitchen qua backend, xử lý mã/email trùng và retry, liên kết
Auth với profiles khi một phần thất bại, thiết lập mật khẩu lần đầu an toàn,
audit thao tác quản trị và kiểm thử toàn luồng. Chỉ thêm quyền Auth Admin ở backend
sau khi lớp xác minh Owner được kiểm chứng trên Supabase thử nghiệm.
