# Ghi chú làm việc cho Claude

- **Báo người dùng khi context bị compact.** Ngay khi thấy cuộc trò chuyện vừa được tóm tắt (compact), câu đầu tiên của tin nhắn tiếp theo phải nói rõ: "Context vừa được compact", kèm việc đang làm dở. Không làm tiếp im lặng.
- Tiến độ và việc tiếp theo nằm trong `PROGRESS.md`; cập nhật file này sau mỗi phần việc. Kế hoạch: `PLAN.md`. Yêu cầu: `REQUIREMENTS.md`.
- Trả lời người dùng bằng tiếng Việt.
- Chỉ commit và push khi xong một phần việc; chỉ tạo PR hoặc merge khi người dùng yêu cầu.
- `SPINE_ACTIVATION_CODE` chỉ được đọc từ biến môi trường: không in ra, không ghi vào code, git hay file kết quả. Che mã trong mọi output (`sed "s/$SPINE_ACTIVATION_CODE/<CODE>/g"`).
- Kiểm tra bằng Spine Editor thật: `npm run spine:check` (cần mạng tới `*.esotericsoftware.com` và gói `x11-xserver-utils`).
