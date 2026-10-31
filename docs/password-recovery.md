# Khôi phục mật khẩu bằng email Supabase

Tài khoản Owner dùng email thật có thể nhận email khôi phục từ Authentication → Users → Send password recovery. Authentication → URL Configuration → Site URL phải trỏ tới địa chỉ HTTPS của POS production, không phải localhost hoặc project thử nghiệm. Nếu thay Site URL, gửi email mới và dùng email mới nhất. Không đưa liên kết chứa token vào log, ảnh chụp, GitHub hoặc trao đổi hỗ trợ.

SDK Supabase hiện dùng implicit callback mặc định. Khi nhận PASSWORD_RECOVERY, POS mở màn hình đặt lại mật khẩu và chưa tải nghiệp vụ. Cờ sessionStorage chỉ lưu user ID để giữ màn hình khi reload; không chứa mật khẩu hay token bổ sung. Việc đổi mật khẩu vẫn yêu cầu phiên Auth hợp lệ và gọi auth.updateUser, không sử dụng service_role hoặc sửa bảng auth bằng SQL.

Mật khẩu mới 6–12 ký tự, nhập lại phải khớp; chỉ hiện thành công sau phản hồi xác nhận từ Auth. Nếu lỗi mạng khiến kết quả chưa rõ, về đăng nhập và thử mật khẩu mới; không giả định đã đổi thành công dựa vào role hoặc hồ sơ. Hoàn tất/thoát xóa cờ recovery và đăng xuất phiên cục bộ, sau đó đăng nhập bằng username hiện có. Liên kết hết hạn không có form ghi mật khẩu; yêu cầu email mới.

Nếu đã cài PWA, hoàn tất công việc, mở POS online để nhận thông báo bản mới, đóng tất cả cửa sổ POS rồi mở lại trước khi dùng email. Không xóa localStorage hoặc cache thủ công khi còn yêu cầu giao dịch đang chờ. Kiểm tra Site URL qua dashboard nếu link mở localhost/địa chỉ khác; không cần chia sẻ URL có token.

Kiểm tra tự động: npm run test:password-recovery-ui và npm run test:username-ui dùng API/token giả, không thay mật khẩu thật. Bao gồm callback SDK, reload, không tải nghiệp vụ trước khi hoàn tất, kiểm tra nhập lại, phản hồi 422/503, không báo thành công khi chưa rõ kết quả, thành công và đăng nhập lại, không lưu mật khẩu vào storage, liên kết hết hạn.

Không có migration, chỉnh quyền hoặc đổi dữ liệu lịch sử. Rollback frontend bằng cách revert commit recovery và phát hành build PWA mới; mật khẩu đã được đổi tại Auth vẫn có hiệu lực. Giữ cơ chế phát hành service worker khi rollback.
