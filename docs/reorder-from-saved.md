# Gọi thêm trực tiếp từ món đã gửi

Món đã gọi có điều chỉnh − / số lượng / + ngay trong màn đơn. Bấm + thêm một đơn vị vào draft hiện tại, làm xuất hiện Gửi bếp. Khi gửi, RPC submit_order chỉ nhận delta draft, không nhận tổng số đã gửi. Ví dụ đã gửi 1, chọn thêm 1, counter hiện 2 và nhãn Đã gửi 1 · Thêm 1 chưa gửi; backend tạo đơn mới qty=1, giữ đơn cũ qty=1. Sau xác nhận counter vẫn 2.

Nút − chỉ bỏ phần gọi thêm chưa gửi, không giảm dưới số đã gửi. Bỏ phần thêm cuối cùng không cần xác nhận hủy bếp vì chưa có ghi nào trên server. Hủy món đã gửi/hủy cả bàn vẫn theo chức năng và quyền hiện có; không cấp thêm quyền hủy từng món cho staff. Món đã trả/đã hủy hiển thị chỉ đọc.

## Hiển thị và dữ liệu

- Các lượt cùng menu_item_id (chưa trả/chưa hủy) gộp một dòng; tổng tiền cộng đúng giá snapshot của từng lượt, cộng phần thêm theo giá menu hiện tại. Không gộp theo tên. Query order_items thêm menu_item_id đã tồn tại từ schema 003, không cần migration.
- Có nhiều lượt: nút ⋯ ở dòng mở chi tiết lượt, số lượng, bill, trạng thái và ghi chú; Owner hủy từng lượt bằng ID gốc như trước. Dữ liệu server không bị gộp/xóa. Các bill vẫn giữ nguyên, đơn thêm vào bill theo quy tắc submit_order hiện có.
- Ghi chú món cũ giữ nguyên; ô Ghi chú món thêm chỉ áp dụng cho phần mới. Ghi chú đơn vẫn dùng quy tắc gửi hiện tại, giới hạn tổng 500 ký tự mỗi món.
- Món hết hàng/ngừng bán không được tăng thêm; phần thêm đang chọn vẫn có thể giảm/xóa. Món thiếu ID hoặc không đối chiếu được menu giữ chỉ đọc, không đoán theo tên.
- Giới hạn 99 đơn vị cho phần thêm trong một lượt gửi; tổng đã gọi có thể lớn hơn 99. Counter không bị chặn chỉ vì số cũ đã đạt 99.

## Đồng bộ và chống trùng

Giữ UUID request và delta cho đến khi nhận snapshot mới từ server, không xóa draft trước khi cập nhật khiến số lượng nhảy lùi. Nếu đang có poll, refresh sau ACK chờ poll đó xong rồi đọc mới. Khi ACK thành công mà đọc lại thất bại, giữ pending, báo đã lưu/chưa đồng bộ, thử lại cùng UUID. Mất ACK/reload vẫn dùng ledger idempotency hiện có. Nếu snapshot đã chứa request, không cộng delta hai lần. Backend/RLS, số tiền server, bếp và các lệnh thanh toán giữ nguyên. Không tự gửi lại khi có mạng, không tạo giao dịch thật trong kiểm thử.

## Kiểm tra

npm run test:reorder-saved: Auth/API giả, 3 vai trò; từ 1 lên 2, giảm phần thêm về nền, chỉ gửi delta=1; ghi chú mới riêng; gộp hiển thị nhưng giữ source; lost response/reload và ACK+đọc lỗi không trùng; giá mới không sửa giá cũ; hết món vẫn bỏ được delta; paid/cancel read-only; quyền hủy giữ nguyên; 375/390/414/desktop; bếp chỉ có ticket mới qty=1. Kiểm tra thêm cùng tên khác ID và thiếu ID không bị gộp nhầm.

POS reference, cancellation, payment và staff-table-cancellation UI suites dùng dữ liệu giả đều đạt. TypeScript/Vite build. Chưa khẳng định kiểm tra trên iPhone/Safari thật.

## Phát hành / quay lại

Chỉ frontend, không cần SQL hoặc Edge Function. Revert commit rồi build/deploy PWA để quay lại. Không xóa localStorage có request đang chờ, không sửa đơn/bill cũ. Hoàn tất thao tác và nhận bản mới sau khi đóng các cửa sổ POS cũ. Phần chọn chưa gửi vẫn chỉ nằm trong bộ nhớ phiên như trước; UUID/payload đã bấm Gửi được lưu theo cơ chế cũ.
