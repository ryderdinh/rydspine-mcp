# Tiến độ rydspine-mcp

Cập nhật file này sau mỗi phần việc. Kế hoạch chi tiết: `PLAN.md`. Yêu cầu: `REQUIREMENTS.md`.

## Tổng quan

| Giai đoạn | Trạng thái | Ghi chú |
|---|---|---|
| 0. Spike & chốt | ✅ Xong (trừ Spine CLI) | Runtime 4.3 chạy headless. Bỏ Spine CLI khỏi v1 vì máy người dùng không được cài Spine |
| 1. Lõi | ✅ Xong bản đầu | MCP server, workspace, lịch sử phiên bản, validate, export |
| 2. Đầu vào | ✅ Xong bản đầu | Nhập bộ PNG, PSD (layer → bộ phận) và project Spine 4.3 có sẵn. Chưa đọc file binary `.skel`; ảnh phẳng chưa tách bộ phận để sau v1 |
| 3. Rig | 🟡 Gần xong | Có bones, slots, mesh theo viền ảnh hoặc lưới + auto weights, IK/transform/physics, mẫu rig (chuỗi, bản lề, bánh xe, chi IK, 2 chân). Chưa có pose_test, mẫu 4 chân, mẫu cánh |
| 4. Animation | 🟡 Một phần | Có oscillate (kèm follow-through), tween (kèm anticipation), bounce, key tay. Chưa có walk/run cycle, chưa có slot/color timeline |
| 5. Kiểm tra & preview | 🟡 Một phần | Có validate, preview ảnh nhiều khung (cả clipping và độ trong suốt), trang HTML player. Chưa có kiểm tra trượt chân / biến dạng |
| 6. Chỉnh sửa | 🟡 Một phần | Có khóa, revert, sửa theo khoảng thời gian. Chưa có diff giữa các phiên bản, chưa nhập lại JSON sửa trong Spine |
| 7. Đầu ra & nghiệm thu | ⬜ Chưa bắt đầu | Chưa có bộ 6 asset nghiệm thu |

## Quyết định đã chốt

- Spine Professional, nhưng **máy người dùng không được cài Spine**. MCP xuất JSON, atlas, PNG và HTML player. Người có Spine dùng File → Import Data để có file `.spine`.
- Phiên bản Spine của người dùng: **4.3.75-beta**, lấy từ file coin. JSON mới tạo ghi đúng phiên bản này; đổi bằng biến `RYDSPINE_SPINE_VERSION`. Runtime npm mới nhất là 4.3.13 và đọc được JSON của 4.3.75-beta.
- Stack: TypeScript/Node, `@modelcontextprotocol/sdk`, `@esotericsoftware/spine-core` và `spine-player` 4.3.13.
- Bảo mật: không lưu license; asset và workspace nằm ngoài git (`.gitignore`).

## Còn chờ người dùng

- Runtime đích (web, Unity, Godot…).
- Asset mẫu thật (được phép dùng) cho bộ nghiệm thu. Đã có: coin (mẫu chính thức của Spine).

## Nhật ký

### 2026-10-30
- Viết `REQUIREMENTS.md` và `PLAN.md`; thêm mục bảo mật và `.gitignore`.
- Spike giai đoạn 0 (`spike/`): skeleton 4.3 viết tay và script kiểm tra bằng runtime. Phát hiện JSON 4.3 gộp các constraint vào mảng `constraints`.
- Lõi MCP (`src/`), 25 tool:
  - dự án, nhập ảnh, xem ảnh;
  - bone, slot, attachment (đặt theo tọa độ world, giữ nguyên vị trí khi gắn vào xương);
  - mesh lưới + auto weights, constraint IK/transform/physics;
  - animation: oscillate, tween, bounce, key tay;
  - validate, preview, export, lịch sử, khóa.
- Test end-to-end qua MCP client thật (`test/e2e.test.ts`, 8 test đạt). Test dựng một con vật nhỏ, tạo animation lặp và animation một lần, kiểm tra từ chối sửa sai, khóa, revert, và mở trang player bằng Chromium.
- Lỗi đã sửa:
  - đổi góc xoay cha–con bị sai, làm ảnh lệch khi gắn vào xương;
  - mesh không hiện trong preview.

### 2026-10-30 (tiếp)
- Nhận project mẫu coin từ người dùng (Spine 4.3.75-beta).
- Thêm tool `project_import`:
  - nhập project Spine 4.3 có sẵn, kèm thư mục ảnh hoặc atlas;
  - khi chỉ có atlas, tự tách lại ảnh gốc, có xử lý xoay, cắt viền và màu premultiplied (PMA);
  - từ chối file binary và JSON trước 4.3, kèm thông báo rõ ràng.
- Ảnh được phép nằm trong thư mục con (`arm/upper`), giống cách Spine đặt tên.
- Preview vẽ được clipping và độ trong suốt của slot.
- Test với coin (11 test đạt):
  - ảnh tách từ atlas trùng từng pixel với ảnh gốc;
  - animation gốc chạy đúng và vòng lặp khớp;
  - thêm animation `pop` bằng tool của MCP;
  - xuất ra rồi nhập lại thì animation gốc giữ nguyên.
- Fixture coin ở `test/fixtures/coin/` kèm `license.txt`. Ảnh của Esoteric Software chỉ dùng phi thương mại.

### 2026-10-30 (tiếp 2)
- `psd_import`:
  - mỗi layer có pixel thành một bộ phận, giữ vị trí, thứ tự, độ trong suốt và chế độ hòa trộn;
  - layer ẩn được bỏ qua (hoặc nhập vào nhưng ẩn đi), tên layer trùng tự đánh số;
  - đọc file 2 lượt để từ chối PSD hoặc layer quá lớn trước khi giải mã, giới hạn bộ nhớ 1 GB.
- `mesh_generate` mặc định tạo mesh theo viền ảnh:
  - dò viền alpha, rút gọn, nới viền 2px;
  - thêm đỉnh bên trong, tam giác hóa Delaunay có ràng buộc để mọi tam giác nằm trong viền;
  - test trên ảnh coin: mesh phủ trên 99,5% điểm ảnh đặc mà vẫn ôm sát.
- `rig_template`: chuỗi đốt (kèm mesh và physics), bản lề, bánh xe, chi 2 đốt có IK, nhân vật 2 chân.
- Lỗi test bắt được và đã sửa: IK gập ngược chiều so với hình vẽ. Giờ gối và khuỷu tay giữ đúng vị trí đã vẽ.
- Test: 20 test đạt (e2e, mesh theo viền, mẫu rig).

## Việc tiếp theo

1. Bộ nghiệm thu 6 asset (`REQUIREMENTS.md` §5): nhân vật chạy → dừng → vung kiếm, rồng vỗ cánh, cây trong gió, rương, xe, logo. Cần asset thật; tạm dùng asset tự vẽ đơn giản.
2. Chu kỳ đi/chạy cho mẫu 2 chân, có kiểm tra trượt chân.
3. Timeline cho slot (màu, độ trong suốt, đổi attachment) và draw order.
4. Mẫu rig 4 chân và cánh.
5. `history_diff` và nhập lại JSON đã sửa trong Spine.
