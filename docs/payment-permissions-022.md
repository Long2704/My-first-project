# Bước 022 — quyền thanh toán

Áp dụng sau 021, chỉ trên project thử nghiệm trước. Migration chỉ thay định nghĩa
pay_bill: kiểm tra payments.collect và yêu cầu payments.discount khi giảm giá > 0.
Owner/Waiter/Kitchen thanh toán được; chỉ Owner giảm giá. Vai trò thu_ngan cũ
không được gọi pay_bill mới. Không xóa hoặc đổi tên cột cashier_id lịch sử.

Giữ nguyên chữ ký RPC, tính tổng từ order_items, khóa bàn/phiên/món, idempotency,
bill_items snapshots, đóng phiên, audit và giữ công việc bếp sau khi khách trả tiền.
Kiểm tra quyền chạy trước idempotency replay để tài khoản bị khóa không nhận lại
hóa đơn qua đường này. Chưa bổ sung so sánh toàn bộ payload khi replay.

Không thay đổi giao diện hoặc RLS đọc hóa đơn. Kitchen hiện chưa đọc được bills
qua policy cũ, còn bị lọc đồ uống trong order_items. Vì thế chỉ kiểm thử API và
đối chiếu trong SQL Editor ở bước này; chưa coi luồng giao diện là đã hoàn thiện.
Waiter vẫn có quyền đọc lịch sử quá rộng theo policy cũ; phải thu hẹp trước production.

Chạy `node tests/payment-permissions-sql.mjs` để kiểm thử PostgreSQL PGlite với
Auth giả lập: thanh toán Waiter/Kitchen, giảm giá Owner-only (amount/percent), tiền
thiếu, danh sách món cũ, phương thức sai, gửi lại cùng request, phiên đã trả, khóa
phiên cũ, actor/thời gian/audit, giữ đơn bếp, hóa đơn cũ và rollback.
Không phải kiểm thử Supabase thật hoặc hai kết nối đồng thời.

Quay lại bằng supabase/rollbacks/022_payment_permissions.sql: khôi phục pay_bill
trước 022, không xóa giao dịch mới. Không cần quay lại 021. Nếu backend/frontend
sau này phụ thuộc quyền mới, cần lập kế hoạch rollback cùng các phần đó.
