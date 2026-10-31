# Tiến độ rydspine-mcp

Cập nhật file này sau mỗi phần việc. Kế hoạch chi tiết: `PLAN.md`. Yêu cầu: `REQUIREMENTS.md`.

## Tổng quan

| Giai đoạn | Trạng thái | Ghi chú |
|---|---|---|
| 0. Spike & chốt | ✅ Xong (trừ Spine CLI) | Runtime 4.3 chạy headless. Bỏ Spine CLI khỏi v1 vì máy người dùng không được cài Spine |
| 1. Lõi | ✅ Xong bản đầu | MCP server, workspace, lịch sử phiên bản, validate, export |
| 2. Đầu vào | ✅ Xong bản đầu | Nhập bộ PNG, PSD (layer → bộ phận), project Spine 4.3 có sẵn dạng JSON hoặc binary `.skel`. Ảnh phẳng chưa tách bộ phận để sau v1 |
| 3. Rig | ✅ Xong bản đầu | Bones, slots, mesh theo viền ảnh hoặc lưới + auto weights, IK/transform/physics, mẫu rig (chuỗi/cánh, bản lề, bánh xe, chi IK, 2 chân, 4 chân), skin (bộ trang phục, biến thể) |
| 4. Animation | ✅ Xong bản đầu | oscillate (kèm follow-through), tween (kèm anticipation), bounce, chu kỳ đi/chạy, key tay, key cho slot (độ trong suốt, màu, đổi hình) |
| 5. Kiểm tra & preview | ✅ Xong bản đầu | validate (kể cả mesh bị gập, ép dẹt, kéo giãn), kiểm tra trượt chân, preview nhiều khung, HTML player, giao diện **rydspine studio** |
| 6. Chỉnh sửa | ✅ Xong bản đầu | Khóa, revert, sửa theo khoảng thời gian, so sánh phiên bản (`history_diff`), nhập lại JSON đã sửa trong Spine (`project_sync`) |
| 7. Đầu ra & nghiệm thu | 🟡 Một phần | Bộ 6 asset nghiệm thu chạy tự động và đạt hết kiểm tra, nhưng dùng art tự vẽ. Spine Editor 4.3.26 đã import được hero. Chưa nghiệm thu trên art thật |

## Quyết định đã chốt

- Spine Professional; người dùng đã có Spine trên máy. MCP xuất JSON, atlas, PNG và HTML player. Người có Spine dùng File → Import Data để có file `.spine`.
- Phiên bản Spine Editor của người dùng: **4.3.26** (file coin mẫu được xuất bằng 4.3.75-beta). JSON mới tạo ghi 4.3.26 để Spine không cảnh báo lệch phiên bản; đổi bằng biến `RYDSPINE_SPINE_VERSION`. Runtime npm 4.3.13 đọc được cả hai.
- Stack: TypeScript/Node, `@modelcontextprotocol/sdk`, `@esotericsoftware/spine-core` và `spine-player` 4.3.13.
- Bảo mật: không lưu license; asset và workspace nằm ngoài git (`.gitignore`).

## Còn chờ người dùng

- Runtime đích (web, Unity, Godot…).
- Asset mẫu thật (được phép dùng) cho bộ nghiệm thu. Đã có: coin (mẫu chính thức của Spine). Người dùng không có PSD, nên tạm dùng art tự vẽ bằng code.
- Kết quả phát animation của hero và dragon trong Spine Editor.

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

### 2026-10-30 (tiếp 3)
- Thêm tool:
  - `anim_slot_keys`: độ trong suốt, màu, đổi hình;
  - `anim_gait`: chu kỳ đi/chạy tại chỗ, báo tốc độ di chuyển khớp với bước chân;
  - `motion_check`: phát hiện chân trượt khi đang chạm đất;
  - `ui_open`: mở giao diện studio.
- Bộ nghiệm thu `acceptance/` (`npm run acceptance`): dựng 6 asset hoàn toàn qua tool MCP, kiểm tra, preview và xuất file. Có trong test tự động.
  - Nhân vật chạy → dừng → vung kiếm: không trượt chân, cả khi chạy lẫn khi dừng.
  - Rồng vỗ cánh, cổ và đuôi trễ pha theo.
  - Cây trong gió, mỗi nhánh một nhịp.
  - Rương nảy lên, mở nắp có nảy, ánh sáng hiện dần.
  - Xe lăn bánh (144,5 px/s), thân nhún.
  - Logo bật ra, nảy, ổn định, có tia lấp lánh.
- Lỗi đã sửa: preview của animation không lặp quay về khung đầu ở thời điểm kết thúc (logo biến mất ở khung cuối).
- Giao diện **rydspine studio** (`npm run ui` hoặc tool `ui_open`):
  - phát animation bằng player Spine chính hãng;
  - xem yêu cầu, kết quả kiểm tra, cây xương, lịch sử phiên bản và dải khung hình;
  - chạy được trên máy tính và điện thoại, nền sáng và nền tối.
  - Bản studio của 6 asset đã đăng làm trang web riêng tư.
- Test: 23 test đạt.

### 2026-10-31
- Đã merge đợt trước vào `main` ([ryderdinh/rydspine-mcp#1](https://github.com/ryderdinh/rydspine-mcp/pull/1)); làm tiếp trên nhánh mới tách từ `main`.
- Đã kiểm tra vùng sáng của rương trong player: không phải lỗi. Màu đạt vàng sáng ở đỉnh; ảnh chụp trước chỉ rơi vào lúc đang mờ dần.
- `validate` phát hiện mesh biến dạng khi chạy animation:
  - tam giác bị lật là lỗi; bị ép dưới 15% hoặc giãn quá 6 lần là cảnh báo;
  - so với mức thay đổi trung vị của cả mesh, nên lật gương, phóng to đều hay bật ra từ 0 không bị báo nhầm;
  - phát hiện thêm: physics có thể quất đuôi đến mức gập mesh khi cả nhân vật phóng to quá nhanh.
- `history_diff`: liệt kê khác biệt giữa hai phiên bản (xương, slot, constraint, attachment, từng timeline, vòng lặp, khóa).
- `project_sync`: nhập lại JSON đã sửa trong Spine Editor thành phiên bản mới, có báo khác biệt, giữ cờ lặp, báo nếu bản sửa đụng vào phần đã khóa; quay lại được.
- Mẫu rig 4 chân (`rig_template` kind `quadruped`): thân, cổ, đầu, 4 chân IK, đuôi tùy chọn. Đi 4 nhịp bằng `anim_gait`, không trượt chân. Cánh dùng mẫu chuỗi đốt.
- Test: 27 test đạt.

### 2026-10-31 (tiếp)
- Đã merge đợt trước ([ryderdinh/rydspine-mcp#2](https://github.com/ryderdinh/rydspine-mcp/pull/2)).
- `project_import` đọc được file binary `.skel`:
  - dùng bộ đọc của runtime Spine rồi chuyển dữ liệu ngược lại thành JSON 4.3;
  - đường cong được khôi phục chính xác từ các điểm lấy mẫu của runtime;
  - test: file `coin-pro.skel` chuyển ra JSON chạy y hệt `coin-pro.json` ở mọi khung;
  - chưa hỗ trợ transform/path/slider constraint và chuỗi ảnh (image sequence); gặp thì báo rõ.
- Skin (`skin_create`, `skin_variant`, `skin_remove`):
  - mỗi skin thay hình cho từng slot, giữ đúng vị trí hình gốc;
  - phần dùng mesh thành linked mesh, uốn cong y như bản gốc;
  - từ chối ảnh sai tỉ lệ; `preview` chọn được skin.
- Test: 30 test đạt.

### 2026-10-31 (tiếp 2)
- Đã merge đợt trước ([ryderdinh/rydspine-mcp#3](https://github.com/ryderdinh/rydspine-mcp/pull/3)).
- `export` kèm thư mục `images/` cạnh file JSON, để Spine Editor (Import Data) tìm thấy hình.
- Người dùng import `hero.json` vào Spine Editor 4.3.26: thành công, hình và xương đúng chỗ. Chỉ có cảnh báo lệch phiên bản (file ghi 4.3.75-beta) → đổi phiên bản mặc định thành 4.3.26.
- Test: 30 test đạt.

## Việc tiếp theo

1. Nghiệm thu trên art thật khi có asset; xác nhận animation chạy đúng trong Spine Editor.
2. Hỗ trợ thêm khi đọc `.skel`: transform/path/slider constraint, chuỗi ảnh.
3. Tách ảnh phẳng thành bộ phận (để sau v1).
