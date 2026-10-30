# rydspine-mcp — Yêu cầu sản phẩm

Trạng thái: Bản nháp để thảo luận. Các yêu cầu chi tiết bên dưới là đề xuất; phạm vi phiên bản đầu chưa được chốt.

## 1. Mục tiêu đã xác nhận

- Xây dựng MCP riêng cho Spine 4.3.
- Công cụ cần dựng rig, bao gồm gắn xương, và tạo animation từ yêu cầu bằng ngôn ngữ tự nhiên.
- Phạm vi phục vụ nhiều loại asset, không chỉ nhân vật.
- Làm rõ yêu cầu trước khi triển khai.

## 2. Đầu vào

Các loại đầu vào cần xem xét:

- PSD có nhiều layer.
- Bộ PNG đã tách từng bộ phận.
- Ảnh phẳng chưa tách bộ phận.
- Project Spine hoặc skeleton JSON có sẵn.
- Mô tả chuyển động; hình ảnh/video tham khảo nếu có.

Cần chốt loại đầu vào bắt buộc cho phiên bản đầu. Với ảnh phẳng, việc tách bộ phận và bổ sung phần bị che là một yêu cầu riêng.

## 3. Phân tích asset

- Nhận diện các bộ phận và quan hệ giữa chúng.
- Xác định cấu trúc phù hợp với từng loại asset.
- Đề xuất vị trí khớp, pivot và phần cần biến dạng.
- Phát hiện bộ phận hoặc dữ liệu còn thiếu.
- Cho phép người dùng sửa kết quả phân tích.

## 4. Dựng rig

- Tạo bones và quan hệ cha–con.
- Thiết lập vị trí khớp và setup pose.
- Tạo slots, attachments và thứ tự hiển thị.
- Tạo mesh và phân bố weights cho phần cần biến dạng.
- Thiết lập IK, transform, path và physics constraints khi cần.
- Hỗ trợ skins và thay đổi attachments.
- Cho phép thử pose, chỉnh rig và sử dụng lại rig có sẵn.

Rig phải phù hợp với cấu trúc và chuyển động cần thực hiện, bao gồm nhiều chân, cánh, chuỗi đốt, bản lề, bánh xe và các phần hình độc lập.

## 5. Tạo animation

- Nhận mô tả hành động bằng ngôn ngữ tự nhiên.
- Tạo pose, keyframes, timing và curves tương ứng.
- Hỗ trợ animation lặp và không lặp.
- Điều chỉnh được thời lượng, tốc độ, biên độ và độ trễ.
- Hỗ trợ anticipation, follow-through và chuyển động phụ.
- Kết hợp nhiều chuyển động trong cùng một animation.
- Cho phép mô tả động tác riêng và mở rộng bộ hành động.

Ví dụ yêu cầu để thảo luận và chọn bộ nghiệm thu:

- Nhân vật chạy, dừng lại rồi vung kiếm.
- Rồng vỗ cánh, cổ và đuôi chuyển động theo.
- Cây nghiêng theo gió, các nhánh dao động khác nhau.
- Rương mở nắp rồi bật nảy nhẹ.
- Xe lăn bánh và thân nhún theo chuyển động.
- Logo xuất hiện, nảy rồi ổn định.

## 6. Chỉnh sửa

- Chỉnh rig và animation bằng yêu cầu tiếp nối.
- Chỉnh theo bộ phận, animation hoặc khoảng thời gian.
- Giữ nguyên các phần nằm ngoài phạm vi chỉnh sửa.
- Cho phép khóa các phần người dùng đã duyệt.
- Lưu phiên bản để so sánh và quay lại.
- Hỗ trợ tiếp tục xử lý sau khi người dùng chỉnh trong Spine.

## 7. Preview và kiểm tra

- Phát animation, tua và xem từng thời điểm.
- Hiển thị bones, mesh, weights và constraints khi cần.
- Kiểm tra bằng runtime Spine 4.3.
- Phát hiện lỗi dữ liệu, thiếu hình và tham chiếu không hợp lệ.
- Hỗ trợ đánh giá lỗi chuyển động như trượt chân, tách khớp, biến dạng bất thường và giật ở điểm nối vòng lặp.
- Cho phép xem lại kết quả sau mỗi lần chỉnh sửa.

## 8. Đầu ra

- Project `.spine` mở và chỉnh sửa tiếp được trong Spine 4.3.
- Skeleton JSON/binary, atlas và texture cho runtime mục tiêu.
- Preview để người dùng đánh giá chuyển động.
- Báo cáo phần đã hoàn thành, lỗi và giới hạn còn lại.

## 9. Tiêu chí nghiệm thu đề xuất

- Hoàn thành luồng từ đầu vào đã thống nhất đến rig và animation.
- Kết quả thể hiện đúng hành động và thông số được yêu cầu.
- Rig đáp ứng phạm vi chuyển động đã thống nhất.
- Animation lặp nối vòng liên tục khi được yêu cầu.
- Chỉnh sửa tác động đúng phạm vi được chọn.
- Kết quả mở được trong Spine 4.3 và chạy trên runtime mục tiêu.
- Có thể chỉnh thủ công tiếp trong Spine.
- Bộ nghiệm thu bao phủ nhiều loại asset, không chỉ nhân vật.
- Có thể khôi phục phiên bản trước khi chỉnh sửa.

Các tiêu chí về chất lượng hình ảnh và chuyển động cần mẫu tham chiếu, tình huống kiểm thử và ngưỡng chấp nhận cụ thể trước khi nghiệm thu.

## 10. Các điểm cần chốt

- Loại đầu vào bắt buộc cho phiên bản đầu.
- Mức tự động hóa và các bước người dùng cần duyệt.
- Loại asset và độ phức tạp ưu tiên.
- Chuẩn chất lượng chuyển động và mẫu tham chiếu nghiệm thu.
- Phiên bản Spine 4.3 cụ thể và runtime đích.
- Hệ điều hành cần hỗ trợ.
- Xử lý qua file hay cần thao tác trong editor đang mở.
- Giới hạn thời gian xử lý và chi phí cho mỗi tác vụ.

## 11. Trạng thái quyết định kỹ thuật

Ngôn ngữ lập trình, SDK, cơ chế kết nối MCP, cách dựng rig và phương pháp tạo chuyển động chưa được chốt. Các phương án đã trao đổi là gợi ý để đánh giá sau khi xác định phạm vi sản phẩm.
