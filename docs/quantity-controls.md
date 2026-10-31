# Sửa hiển thị nút tăng/giảm — 01/11/2026

Tái hiện trên Chromium cảm ứng 390×844: khung số lượng cao 28px, button cao 44px và margin âm nên nền nút vượt khung. Sau tap, :active đã tắt nhưng :hover vẫn giữ nền xám. Ảnh trước/sau được kiểm tra tại máy thực hiện, không sử dụng dữ liệu quán.

Sửa giới hạn ở QuantityControl và CSS POS: khung 120×44px, ba ô nằm trong khung, bỏ margin âm và pseudo-element mở rộng chồng lên số. Nền nhấn giữ bên trong border; hover chỉ có khi thiết bị có chuột/con trỏ chính xác. Touch-action manipulation, bỏ tap highlight và chọn văn bản trên nút, vẫn giữ focus-visible bằng bàn phím. Button khai báo type=button, không đổi logic số lượng hoặc tiền.

npm run test:quantity-touch: menu và đơn, tap lặp tăng/giảm, nền xóa ngay sau nhả, không vượt khung, số một/hai chữ số, tên món dài, không tràn ngang 375/390/414, giảm cuối cùng mở xác nhận, Enter vẫn tăng. Fixture Auth/menu/bàn qua API giả; không gửi đơn, thanh toán hay email thật. Browser là Chromium giả lập cảm ứng, chưa khẳng định kiểm tra trực tiếp iPhone/Safari.

TypeScript/Vite build và POS reference suite kiểm tra giỏ, ghi chú, gửi bếp/thanh toán chống trùng. Không SQL/Edge changes. Rollback: revert commit sửa nút, build/deploy PWA mới. Nhận bản mới sau khi hoàn tất việc đang chờ, đóng các cửa sổ POS và mở lại; không xóa dữ liệu trình duyệt khi có giao dịch chờ.
