# Quyền tập trung — bước 021

## Phạm vi

Giữ mã vai trò `chu` / `phuc_vu` / `bep`, hiển thị tương ứng Owner / Waiter / Kitchen.
`public.has_permission(text)` lấy UUID từ `auth.uid()` và đọc hồ sơ còn hoạt động.
Không nhận UUID, vai trò hoặc quyền do frontend khai báo. Quyền không tồn tại,
tài khoản thiếu hồ sơ, bị khóa hoặc vai trò `thu_ngan` đều nhận `false`.
Người chưa đăng nhập không được gọi hàm trực tiếp.

Danh sách quyền nằm trong một hàm SQL được quản lý bằng migration. Đây chưa phải
giao diện tự định nghĩa vai trò hoặc bộ quyền. Owner chỉ chọn vai trò đã hỗ trợ.
Mỗi lần kiểm tra dùng khóa chính profiles.id; không tải toàn bộ nhân viên hoặc
tạo thêm yêu cầu mạng từ frontend cho mỗi món. Không cache trạng thái khóa vào JWT.

## Thay đổi đã nối vào nghiệp vụ

Chỉ `submit_order` chuyển sang `has_permission('orders.create')`.
Các kiểm tra giá server, số lượng, idempotency, khóa bàn và ghi nhật ký được giữ.
Danh sách các quyền khác là cấu hình mục tiêu, CHƯA có nghĩa các RPC khác đã dùng
hàm mới. Đặc biệt Waiter và Kitchen CHƯA được thanh toán bằng pay_bill hiện tại.
Đổi pay_bill còn cần tách quyền giảm giá, kiểm thử chống thu trùng và audit.
Không có thay đổi frontend hoặc production.

## Áp dụng trên project thử nghiệm

1. Project đã chạy 017, 018, 019, 020: chỉ chạy toàn bộ file
   `supabase/migrations/021_central_permissions.sql` một lần trong SQL Editor.
2. Không chạy lại 017–020. Các file này được lưu ở repository để tái lập các bước
   người dùng đã thực hiện thủ công, không yêu cầu người dùng áp dụng lại.
3. Trong Console của app localhost đang đăng nhập Waiter, dùng module đã có:

```js
console.log(await posCheck.supabase.rpc('has_permission', {
  p_permission: 'orders.create'
}));
console.log(await posCheck.supabase.rpc('has_permission', {
  p_permission: 'employees.manage'
}));
```

Kỳ vọng data lần lượt là true / false và error đều null.
Không dùng SQL Editor để kiểm tra vai trò người đăng nhập trong trình duyệt.

Để xác minh Kitchen trên Supabase thật: tạo tài khoản thử trong Authentication,
tạo profiles với role='bep', mã riêng, is_active=true; đăng nhập riêng và kiểm tra
orders.create=true, kitchen.complete=true, employees.manage=false. Chưa thay đổi
UI Kitchen nên không được coi đây là kiểm thử hoàn chỉnh màn hình phục vụ.

## Kiểm thử tự động

```sh
node tests/central-permissions-sql.mjs
```

PGlite chạy SQL PostgreSQL cục bộ, auth.uid() và người dùng là giả lập. Kiểm tra:
ma trận quyền; quyền lạ; tài khoản thiếu hồ sơ; ẩn danh; Owner/Waiter/Kitchen tạo
đơn có món; giá server; từ chối giá cũ/số lượng sai; request gửi lại; khóa/mở khóa
không đổi claim người dùng; Kitchen hoàn thành bếp; chặn ghi trực tiếp; giữ nguyên
đơn trước migration và hàm thanh toán; rollback rồi áp dụng lại.

Chưa kiểm chứng Supabase thật, Auth thật, email, hai kết nối đồng thời hoặc dữ liệu
production. Các test không thay thế kiểm thử API trên project thử nghiệm.

## Những phần còn phải chuyển

- pay_bill và quyền giảm giá riêng; báo cáo, quản lý thực đơn/nhân viên.
- Chuyển bàn (cả wrapper và hàm nội bộ), tách bill, hủy món/bàn theo quyền đã chốt.
- RLS đọc đơn và lịch sử hóa đơn; hiện Kitchen còn bị lọc đồ uống ở order_items.
- Giao diện hiện vẫn phân vai cũ, chưa dùng mô hình quyền mới.
- Rà soát policy có nhánh auth.uid() riêng để chặn tài khoản khóa đầy đủ.
- Phòng tránh quyền mặc định rộng cho các bảng được tạo trong migration tương lai.

## Quay lại

Trước khi có migration mới phụ thuộc has_permission, chạy
`supabase/rollbacks/021_central_permissions.sql` trên project thử nghiệm.
File khôi phục submit_order của 020 rồi xóa hàm mới, không xóa đơn hoặc thanh toán.
Không dùng CASCADE. Nếu đã có phần phụ thuộc mới, dừng và lập phương án rollback
cùng các phần đó. Không xóa trạng thái khóa hoặc cơ chế bảo vệ Owner.
