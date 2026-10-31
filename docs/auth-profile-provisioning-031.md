# 031 — Sửa Auth user có nhưng thiếu profile

## Bằng chứng production
Người dùng gửi Auth log có POST /admin/users 200 và truy vấn request [request production đã xác nhận], username nhân viên cần khôi phục: Auth tồn tại nhưng user_id/completed_at NULL, profile chưa có. Chưa đọc trực tiếp log DB/metadata production, không kết luận đã quan sát trình tự UPDATE thật. Đã tái hiện cùng triệu chứng bằng thứ tự Auth INSERT trước rồi UPDATE metadata; trigger cũ chỉ INSERT bỏ sót.

## Sửa
Core complete_employee_creation đọc chính Auth record và request khóa hàng; kiểm tra UUID, email và marker đối với request chưa hoàn tất, Owner còn quyền, có mật khẩu; không ghi đè profile đã có. Liên kết profile/request/audit trong cùng transaction. Wrapper trigger hỗ trợ INSERT, UPDATE metadata/password và idempotent khi request đã xong. Khi Auth chưa có hash, đợi UPDATE kế tiếp thay vì báo hoàn tất giả.

staff_initial_auth_txid giữ cờ đổi mật khẩu khi Auth tiếp tục cập nhật hash trong cùng transaction tạo user. Chỉ lần nhân viên thật sự đổi mật khẩu ở transaction sau mới bỏ cờ. Giữ nonce/session reset030. Các lần password/metadata update sau khi đã hoàn tất không lặp profile/audit và không phụ thuộc email hiện tại còn giống email lúc cấp ban đầu.

## Áp dụng
- supabase/migrations/031_auth_profile_provisioning.sql: sửa chung, sau030; không khôi phục tùy tiện các orphan khác.
- file khôi phục riêng đã gửi qua artifact: gồm migration031 và repair đúng request/user đã xác nhận trong một transaction. Chạy NGUYÊN FILE một lần ở production; không chạy cả hai file vì trùng migration.
- Repair giữ Auth UUID/email/hash, chỉ bổ sung marker nếu thiếu và email đúng dạng UUID nội bộ. Nếu marker thuộc request khác, không có hash, Owner mất quyền hoặc username/role khác kết quả đã xác nhận: abort toàn bộ. Không xóa, đổi mật khẩu hay tạo Auth user mới.
- Kết quả cuối gồm username/name/role/is_active/must_change_password/completed. nhân viên cần khôi phục cần completed=true, must_change_password=true. Bấm Kiểm tra lại trong app để xác nhận request cũ; không tạo lại.

## Kiểm thử
PGlite/Auth giả lập tái hiện lỗi cũ, repair giữ ID/email/hash và audit một lần; replay repair không tạo lặp; thử metadata trước/hash trước/cùng UPDATE/INSERT đã đủ dữ liệu, Auth ghi hash lần nữa cùng transaction vẫn bắt đổi mật khẩu. Nhân viên tự đổi sau đó mở cờ bình thường; giữ hóa đơn. Đây không phải kiểm thử kết nối production.

## Quay lại
Không xóa profile nhân viên cần khôi phục hoặc Auth user vừa khôi phục. Nếu có lỗi mới từ UPDATE hook, tạm ngừng cấp tài khoản mới bằng thu hồi EXECUTE prepare_employee_account/prepare_employee_creation; giữ đăng nhập và lịch sử. Cần đối chiếu lỗi trước khi gỡ hook/helper vì gỡ có thể tái tạo orphan hoặc phá bắt đổi mật khẩu. Lỗi SQL trước COMMIT tự rollback toàn bộ; không chạy phần repair riêng khi migration chưa thành công.
