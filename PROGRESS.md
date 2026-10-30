# Tiến độ rydspine-mcp

Cập nhật file này sau mỗi phần việc. Kế hoạch chi tiết: `PLAN.md`. Yêu cầu: `REQUIREMENTS.md`.

## Tổng quan

| Giai đoạn | Trạng thái | Ghi chú |
|---|---|---|
| 0. Spike & chốt | ✅ Xong (trừ Spine CLI) | Runtime 4.3 chạy headless. Bỏ Spine CLI khỏi v1 vì máy người dùng không được cài Spine |
| 1. Lõi | ✅ Xong bản đầu | MCP server, workspace, lịch sử phiên bản, validate, export |
| 2. Đầu vào | 🟡 Một phần | Có nhập bộ PNG và nhập project Spine 4.3 có sẵn (JSON + thư mục ảnh hoặc atlas). Chưa có PSD, chưa đọc file binary `.skel` |
| 3. Rig | 🟡 Một phần | Có bones, slots, mesh lưới + auto weights, IK/transform/physics. Chưa có template rig, mesh theo viền ảnh, pose_test |
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

## Việc tiếp theo

1. Nhập PSD (`ag-psd`): mỗi layer thành một bộ phận, giữ đúng vị trí và thứ tự.
2. Template rig cho các loại cấu trúc (2 chân, có cánh, chuỗi đốt, bản lề, có bánh) để giảm số bước.
3. Mesh theo viền ảnh (alpha contour) thay cho lưới chữ nhật.
4. Bộ nghiệm thu 6 asset theo `REQUIREMENTS.md` §5.
