# Tiến độ rydspine-mcp

Cập nhật file này sau mỗi phần việc. Kế hoạch chi tiết: `PLAN.md`. Yêu cầu: `REQUIREMENTS.md`.

## Tổng quan

| Giai đoạn | Trạng thái | Ghi chú |
|---|---|---|
| 0. Spike & chốt | ✅ Xong (trừ Spine CLI) | Runtime 4.3 chạy headless. Bỏ Spine CLI khỏi v1 vì máy người dùng không được cài Spine |
| 1. Lõi | ✅ Xong bản đầu | MCP server, workspace, lịch sử phiên bản, validate, export |
| 2. Đầu vào | ✅ Xong bản đầu | Nhập bộ PNG, PSD (layer → bộ phận, layer `[pivot]` → xương), project Spine 4.3 có sẵn dạng JSON hoặc binary `.skel`, ảnh phẳng (`image_split`: tự tách mảng rời hoặc cắt theo polygon, vẽ bù phần bị che đơn giản) |
| 3. Rig | ✅ Xong bản đầu | Bones, slots, mesh theo viền ảnh hoặc lưới + auto weights, IK/transform/physics, mẫu rig (chuỗi/cánh, bản lề, bánh xe, chi IK, 2 chân, 4 chân), skin (bộ trang phục, biến thể) |
| 4. Animation | ✅ Xong bản đầu | oscillate (kèm follow-through), tween (kèm anticipation), bounce, chu kỳ đi/chạy, key tay, key cho slot (độ trong suốt, màu, đổi hình) |
| 5. Kiểm tra & preview | ✅ Xong bản đầu | validate (kể cả mesh bị gập, ép dẹt, kéo giãn), kiểm tra trượt chân, preview nhiều khung, HTML player, giao diện **rydspine studio** |
| 6. Chỉnh sửa | ✅ Xong bản đầu | Khóa, revert, sửa theo khoảng thời gian, so sánh phiên bản (`history_diff`), nhập lại JSON đã sửa trong Spine (`project_sync`) |
| 7. Đầu ra & nghiệm thu | 🟡 Gần xong | Bộ 8 asset nghiệm thu (art tự vẽ) chạy tự động và đạt hết kiểm tra. Cả 8 asset đã qua vòng Spine Editor 4.3.26 thật (`npm run spine:check`), chạy được cả trên máy Mac của người dùng. Đã nghiệm thu trên art thật (rồng của Spine, `npm run real:art`); còn chờ art của người dùng |

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

### 2026-10-31 (tiếp 3)
- Đã merge đợt trước ([ryderdinh/rydspine-mcp#4](https://github.com/ryderdinh/rydspine-mcp/pull/4), [ryderdinh/rydspine-mcp#5](https://github.com/ryderdinh/rydspine-mcp/pull/5)).
- Chạy Spine Editor 4.3.26 Professional thật trên cloud:
  - launcher tải từ trang license của người dùng, kích hoạt bằng `SPINE_ACTIVATION_CODE`; mã không bị in ra và không nằm trong file nào của repo hay kết quả;
  - cần mở mạng cho `*.esotericsoftware.com` (máy chủ API kích hoạt và tải editor), cài `x11-xserver-utils` (libxrandr) để Spine vẽ ảnh dưới Xvfb.
- `npm run spine:check` (`acceptance/spine-check.ts`):
  - dựng 6 asset, cho Spine import JSON thành `.spine` rồi xuất lại JSON (kèm nonessential);
  - runtime phát cả hai bản từng khung, kể cả physics, so mọi xương, màu slot và đỉnh attachment;
  - Spine xuất chuỗi PNG từng animation, ghép thành dải 8 khung;
  - dùng `SPINE_CLI` nếu có; nếu không, trên Linux có `SPINE_ACTIVATION_CODE` thì tự tải launcher vào `~/.cache/rydspine/spine`; thiếu cả hai thì bỏ qua.
- Lỗi chỉ Spine Editor phát hiện (runtime chấp nhận), đã sửa:
  - **mesh có trọng số không import được** ("Index -2 out of bounds", dragon và tree): mỗi đỉnh phải liệt kê xương theo thứ tự của skeleton; trước đây xếp theo trọng số;
  - **cảnh báo thiếu nonessential** khi import: mesh giờ ghi `edges` (viền);
  - **hero lệch IK sau khi qua Spine**: Spine bắt thời điểm key gần khung hình về đúng khung (0.033 → 1/30). Giờ rydspine ghi luôn thời điểm đúng khung khi lệch dưới 2 ms.
- Kết quả: cả 6 asset đạt, lệch tối đa 0,0011 px; dải hình do Spine vẽ đúng ý đồ.
- Test nghiệm thu kiểm thêm 3 quy tắc trên (test hỏng nếu bỏ phần sửa). Test: 30 test đạt.

### 2026-10-31 (tiếp 4)
- `.skel` giờ đọc được transform, path và slider constraint, chuỗi ảnh (region và mesh), cùng các timeline của chúng; linked mesh lấy nguồn từ slot khác ghi thêm `slot`.
- Kiểm bằng bộ ví dụ chính thức (`github.com/EsotericSoftware/spine-runtimes`, nhánh 4.3, 44 file `.skel`). Script mới `npm run skel:examples` tải thưa thư mục `examples/*/export` vào `~/.cache/rydspine/spine-runtimes`, chuyển từng file rồi so với runtime đọc thẳng `.skel`, mọi animation, từng khung, có physics:
  - trước: 18 file bị từ chối vì tính năng chưa hỗ trợ, vài file đọc được nhưng lệch tới 1000 px;
  - sau: 43/44 đạt, lệch tối đa 0,01; file còn lại (diamond) là trường hợp suy biến của runtime JS, đã ghi lý do trong script.
- Lỗi cũ tìm ra nhờ bộ ví dụ:
  - **số float32 làm tròn còn 7 chữ số**: không khôi phục đúng giá trị, key ở đúng khung bị lùi 1 ulp sang khung trước (powerup, spineboy lệch tới 87). Giờ ghi số ngắn nhất mà vẫn khôi phục đúng float32 (tới 9 chữ số);
  - **`mixY` của transform** mặc định theo `mixX` của pose, kể cả khi không dùng x; giờ luôn ghi khi cần.
- Fixture mới `test/fixtures/features` do chính Spine 4.3.26 tạo (`acceptance/skel-fixture.ts`): test so từng bit các frame của timeline, so tư thế với bản nhị phân và với JSON của Spine. JSON chuyển từ `.skel` của 7 ví dụ lớn đều được Spine import lại.
- `constraint_add` thêm **path** và **slider**:
  - path: đưa các điểm world-space, rydspine tạo slot `<tên>-path` với đường cong mượt (Catmull-Rom) đi qua các điểm, rồi constraint; `closed` cho bánh xích, `pathBone` để path đi theo một xương;
  - slider: phát một animation theo `time` hoặc theo thuộc tính của một xương điều khiển; `anim_remove` từ chối xoá animation mà slider đang dùng.
- **Lỗi của Spine Editor 4.3.26**: khi import, Spine sắp xếp animation theo tên (tự nhiên, không phân biệt hoa thường, thư mục sau cùng) nhưng giữ animation của slider theo vị trí trong file, nên slider trỏ nhầm. rydspine giờ luôn lưu animation theo đúng thứ tự đó; dự án path + slider qua Spine khớp hoàn toàn.
- `acceptance/compare.ts`: tách phần so tư thế dùng chung cho `spine:check`, test `.skel` và `skel:examples`; so thêm khung của chuỗi ảnh; có thể lấy mẫu giữa hai khung. `spine:check` thử lại một lần khi xuất ảnh lỗi thoáng qua, và báo phần cuối log.
- Skill `.claude/skills/spine-rigging/SKILL.md`: quy trình dùng tool, công thức từng loại constraint với số liệu từ 30 dự án ví dụ (physics dùng nhiều nhất: inertia ≈ 0,37, strength ≈ 135, damping ≈ 0,82; transform `mixX: -1` để giữ cố định; path `percent` + `chainScale` cho tay chân cao su, `length` + `chain` cho xích), và các quy tắc Spine Editor khắt khe.
- Test: 35 test đạt; `spine:check` 6/6 (car lỗi xuất ảnh một lần, chạy lại được).

### 2026-10-31 (tiếp 5)

- Tool `anim_constraint_keys`: key cho mọi timeline constraint theo đúng cách runtime 4.3 đọc JSON. IK (mix, softness, bend, compress, stretch), mix của transform/path, position/spacing của path, physics (inertia, strength, damping, mass, wind, gravity, mix, reset; constraint `""` = mọi physics), slider (time, mix). Kênh bỏ trống giữ giá trị setup; ease tạo một bezier cho mỗi kênh. Lưu ý: transform chỉ có mix ở kênh được điều khiển, kênh khác runtime đọc là 0.
- Tool `sequence_import`: các PNG thành một attachment chuỗi ảnh (ảnh `<tên>/<tên>01…`, `start` 1, `digits` 2), slot mới hoặc thêm vào slot có sẵn. Tool `anim_sequence_keys`: mode, frame bắt đầu, delay. `validate` kiểm mọi frame; `preview` vẽ đúng frame đang hiện.
- `constraint_remove` xoá luôn timeline của constraint (trước đây runtime từ chối skeleton). Độ dài animation tính cả timeline constraint và chuỗi ảnh.
- Asset nghiệm thu thứ 7 `lantern` (đèn lồng) dùng cả ba tool: lửa chuỗi ảnh 4 frame, gió physics có key, slider, đốm sáng chạy theo path đóng, mix transform có key. `spine:check` 7/7, lantern lệch 0,0000 sau khi qua Spine.
- Tìm và ghi các MCP Spine của cộng đồng vào `REFERENCES.md`, kèm ý tưởng nên lấy.
- Test: 38 test đạt.

### 2026-10-31 (tiếp 6)

- Tool `event_define` (giá trị int/float/string, audio kèm volume/balance; `remove` xoá cả key) và `anim_event_keys` (key chỉ ghi giá trị khác định nghĩa; event chưa có thì tự định nghĩa; cùng tên cùng thời điểm thì thay). `events` được đặt trước `animations` như Spine ghi.
- Tool `anim_draw_order_keys`: mỗi key cho thứ tự slot từ sau ra trước, đủ hoặc chỉ các slot đổi chỗ (chúng đổi các vị trí đang giữ trong setup); không có `order` là về setup. Offset ghi gọn như Spine (dãy tăng dài nhất giữ nguyên), dùng chung `src/draworder.ts` với phần đọc `.skel`. `slot_update` đổi thứ tự slot thì tính lại mọi key để mỗi key vẫn hiện đúng thứ tự cũ.
- `anim_gait` báo thời điểm từng chân chạm đất; tuỳ chọn `event` (vd `footstep`) key event ở đó, string là tên xương chân. Asset `hero` dùng cho cả hai animation chạy.
- Mọi `ease` (key xương, slot, constraint, tween) nhận thêm bezier kiểu CSS `[x1, y1, x2, y2]`; x phải trong 0..1, y được vượt để tạo nảy.
- `project_status` liệt kê event và key thứ tự vẽ. `spine:check` so thêm các event mỗi animation bắn ra (thời điểm, giá trị).
- Asset `chest`: nắp bật bằng bezier tự đưa, quầng sáng vẽ đè lên nắp khi mở, event `creak` (audio) và `sparkle`.
- Test: 41 test đạt. `spine:check` 7/7: event của chest (3) và bước chân của hero (2 và 4) khớp sau khi qua Spine, thứ tự vẽ khớp mọi frame, lệch ≤ 0,0011.

### 2026-10-31 (tiếp 8)

- `mirror_bones`: chép một bên rig (xương con, slot, attachment region/mesh/path/box/clip/point, IK đảo bendPositive, physics) qua đường gương dọc; tên đổi bên (left↔right, l↔r, camelCase, `sides` tuỳ chọn).
- `mirror_animation`: `swap` đổi timeline trái/phải giữ giá trị; `mirror` phản chiếu (rotate/shear đổi dấu, translate theo khung cha, IK bend theo setup, deform mesh không weight). Slot, constraint, draw order, event đổi bên theo.
- Test `test/mirror.test.ts` (4): runtime xác nhận mỗi xương của bản mirror trùng ảnh phản chiếu của bản gốc. Chưa chạy `spine:check` cho phần này.

## 2026-10-31 (tiếp 7)

- Tool `shape_add`: attachment `point` (vị trí, hướng theo world, đi theo xương), `boundingbox` và `clipping` trong slot mới. Hình là các điểm world, hoặc `around` dò viền ảnh (region) hay viền hull (mesh) của một slot, `padding` nới ra. Clipping che các slot từ `from` tới `end` và được đặt ngay dưới `from`; key thứ tự vẽ được tính lại (slot mới nằm ngay dưới slot phía trên nó trong setup).
- Path constraint nhận `pathBones` (và `maxInfluences`, mặc định 2): mỗi điểm của đường cong gắn trọng số vào các xương điều khiển gần nhất, tay nắm theo trọng số của điểm. Từ chối xương thuộc chính chuỗi được path kéo (vòng lặp). Tách phần tính trọng số dùng chung với `mesh_generate`.
- `preview` (khi hiện xương) vẽ bounding box nét đứt và point.
- `spine:check` so thêm đỉnh của mọi attachment dạng đỉnh (bounding box, clipping, path) và vị trí/hướng của point.
- Asset nghiệm thu: `tree` có dây leo treo trên nhánh, path gắn vào nhánh và xương đầu dây; `chest` có point `coin-spawn` trên nắp, vùng va chạm dò theo thân rương và clipping cho quầng sáng.
- Test: 44 test đạt. `spine:check` 7/7, lệch ≤ 0,0011.

### 2026-10-31 (tiếp 9)

- `psd_import` đọc layer đánh dấu pivot:
  - layer `<tên>[pivot]` (chấm nhỏ, không phân biệt hoa thường, ẩn cũng được) không thành hình; tại tâm của nó, rydspine tạo xương cho layer hoặc nhóm `<tên>` nằm cạnh;
  - `[pivot]` (hoặc `<tên nhóm>[pivot]`) nằm trong nhóm là xương của nhóm;
  - xương lồng nhau theo nhóm PSD; bộ phận không có pivot riêng thì gắn vào xương của nhóm gần nhất, hình giữ nguyên vị trí;
  - marker không khớp layer nào, hoặc bị trùng, được liệt kê ở phần bỏ qua; không có marker thì kết quả như cũ.
- Máy Mac của người dùng có Spine: `SPINE_CLI=/Applications/Spine.app/Contents/MacOS/Spine npm run spine:check` chạy được.
- Asset nghiệm thu thứ 8 `crab` (cua): dựng từ PSD có marker pivot (nhóm tay → càng → kẹp), mesh có trọng số ở tay; `mirror_bones` tạo nửa phải; `mirror_animation` tạo `wave-right` (mirror) và `wave-swap` (swap). `spine:check` 8/8, cua lệch 0,0000 ở cả 3 animation; dải hình do Spine vẽ cho thấy `wave-right` là ảnh gương của `wave`.
- Test: 45/49 đạt trên máy Mac. 4 test lỗi vì máy chưa cài gói `playwright` (cần cho preview PNG và trang player); trên `main` sạch cũng lỗi y như vậy.
- `playwright` 1.64.1 thành devDependency (cài Chromium: `npx playwright install chromium`). Lỗi lộ ra sau đó: test trang player mất WebGL context (`getParameter` trả `null`) vì cờ cũ `--use-gl=swiftshader`. Trên Chromium 156 (macOS), cờ này hỏng khi đã có vài lần mở Chromium trước trong cùng tiến trình (do preview). Đổi sang `--use-angle=swiftshader`. Test: 49/49 đạt trên máy Mac.

### 2026-10-31 (tiếp 10)

- Nghiệm thu trên art thật: `npm run real:art` (`acceptance/real-art.ts`) dùng con rồng trong bộ ví dụ của Spine (art của Thiago Brayner; giấy phép chỉ cho trình diễn, không phát tán, không làm tác phẩm phái sinh, nên chỉ tải vào `~/.cache/rydspine/spine-art`, kết quả nằm trong `acceptance/out/`).
  - Bộ ví dụ không có PSD, nên script dựng PSD giống file họa sĩ giao: 30 bộ phận vẽ đúng chỗ (xoay như tư thế setup gốc), layer phẳng theo thứ tự vẽ, chấm `<phần>[pivot]` ẩn ở mỗi khớp; cánh là chuỗi 9 frame.
  - Chỉ dùng tool MCP: `psd_import`, `bone_add` (khớp không có hình), `bone_update` (cây xương, hướng và độ dài), `sequence_import` cho cánh, physics cho đuôi, animation `fly` 0,9 s (cánh lặp 9 frame, thân nhún, cổ/đầu/hàm/chân/đuôi lệch pha).
  - Kết quả: tư thế setup trùng bản gốc 99,99% vùng đặc, lệch màu trung bình 0,31/255; 32 xương nằm đúng khớp (lệch ≤ 0,63 px vì chấm pivot là số nguyên) và đúng hướng (≤ 0,005°); validate đạt, vòng lặp khớp; qua Spine Editor lệch 0,0000.
- Thiếu sót lộ ra nhờ art thật: xương tạo từ pivot dài 0, góc 0, nên physics `rotate` không có tác dụng; đổi góc xương thì kéo hình và xương con theo. Thêm `bone_update` `compensate: true` (như "Compensate" của Spine Editor): hình (region, mesh không trọng số) và xương con giữ nguyên chỗ khi xương dời hoặc xoay; từ chối khi đổi scale (region không biểu diễn được kéo giãn theo trục xoay). Test `test/compensate.test.ts`.
- `spine-check.ts` tách hàm `roundTrip` dùng chung.
- Test: 50/50 đạt.

### 2026-10-31 (tiếp 11)

- Bộ cài cho người khác (không cần biết dòng lệnh): trang `docs/index.html` (bật GitHub Pages thư mục `docs/`) có nút tải bộ cài theo hệ điều hành.
  - macOS/Linux: `rydspine-setup-mac.zip` chứa `rydspine-setup.command` (zip để giữ quyền chạy; tải thẳng thì mất). Windows: `rydspine-setup-windows.bat`. Nguồn ở `installer/`, đóng gói bằng `npm run installers`.
  - Bộ cài kiểm tra Node 20+, tải mã nguồn bằng `curl` + `tar` (không cần git) vào `~/.rydspine/app`, `npm install --omit=dev`, rồi chạy trình cài đặt `src/setup.ts` (`npm run setup`).
  - `src/setup.ts`: hỏi từng app có trên máy rồi ghi cấu hình MCP bằng đường dẫn tuyệt đối (app GUI không thấy PATH của nvm): Claude Code (`claude mcp add -s user`, chép skill `spine-rigging`), Claude Desktop (`claude_desktop_config.json`, sao lưu trước), Codex (`codex mcp add`); hỏi tải Chromium cho preview PNG; dò Spine Editor; cuối cùng chạy server và đếm tool. Dự án lưu ở `~/.rydspine/workspaces`. Cờ `--yes`, `--clients=`, `--no-chromium`, `--home=<thư mục>` (chạy thử không đụng cấu hình thật).
  - `tsx` và `playwright` chuyển sang `dependencies` vì máy người dùng chạy server bằng tsx và preview cần playwright.
  - Đã thử trọn quy trình trên Mac (từ file zip giải nén bằng `ditto` như Safari, cài vào thư mục tạm): cả 3 app ghi đúng cấu hình, server chạy với 46 tool. Bộ cài Windows chưa chạy thử trên máy Windows.
- Chặn: repo đang private, nên bộ cài (tải từ `codeload.github.com`) và GitHub Pages chỉ chạy khi repo chuyển public. Trước đó thử bằng `RYDSPINE_SOURCE=<repo>`.
- Demo trong phiên (không commit, art do Codex vẽ): robot vẫy tay (IK, chuỗi ăng-ten, physics), tấm vải bị kéo lên (mesh nhiều xương + physics; validate bắt mesh gập và đã chỉnh), rèm cuốn từng nấc (clipping đi theo cuộn rèm, event `notch`).
- Test: 50/50 đạt.

### 2026-10-31 (tiếp 12)

- Đã merge `claude/psd-pivots` vào `main` (merge commit `a7f92d9`, merge bằng git vì máy không có `gh`).
- Tách ảnh phẳng (`src/split.ts`), thêm 2 tool (tổng 48):
  - `image_inspect`: ảnh có lưới toạ độ đánh số (pixel ảnh, y hướng xuống), nền dò được, các mảng rời và khung của chúng.
  - `image_split`: không có `parts` thì mỗi mảng rời trên nền là một bộ phận (mảng nhỏ hơn `minArea` gộp vào mảng gần nhất); có `parts` thì cắt theo polygon, liệt kê từ sau ra trước, chỗ chồng nhau thuộc bộ phận phía trước, pixel lẻ trong `snap` px gộp vào bộ phận gần nhất. Nền: `auto` (trong suốt nếu viền trong suốt, không thì màu phổ biến nhất ở viền, loang từ viền nên vùng trắng nằm kín bên trong vẫn giữ), `transparent` hoặc mã màu. `overlap` vẽ bù phần bị bộ phận phía trước che bằng cách loang màu mép vào, chỉ trong polygon của bộ phận. Trả overlay tô màu từng bộ phận (pixel chưa thuộc ai màu magenta); `dryRun` chỉ trả overlay. Nhập như `psd_import` (gốc toạ độ mặc định giữa đáy).
  - Test `test/split.test.ts` (5 ca). Tổng 55/55 test qua.
- Thử thật trên nhân vật Codex vẽ (1254x1254, nền trắng, không commit): 6 bộ phận (2 tay, 2 chân, thân, đầu) sau 2 lần chỉnh polygon, rig 7 xương, animation vẫy tay. Validate OK, Spine 4.3.26 nhập được. Bài học (đã ghi vào skill): phải khoanh cả phần bị che (cổ dưới đầu, đầu đùi dưới áo), nếu không khớp hở trắng khi xoay.
- Hạn chế: vẽ bù chỉ loang màu (không vẽ lại chi tiết); (đã sửa ở tiếp 13) viền khử răng cưa với nền màu giữ quầng nhạt; dưới nách còn vệt nhỏ khi polygon của tay rộng hơn dáng tay.

### 2026-10-31 (tiếp 13)

- `image_split` khử quầng viền khi ảnh có nền một màu (`matte`, mặc định 2 px, 0 = tắt): mỗi pixel ở dải mép được đọc như màu nền pha với một màu nét gần đó (pixel khác nền nhất mà vẫn giải thích được màu mép), rồi nhận độ trong suốt của phép pha và màu nét thật. Pixel không giải thích được, hoặc thuộc một mảng màu phẳng chạm nền (da sát nền trắng), giữ nguyên. Kết quả báo số pixel đã xử lý.
- Thử trên ảnh cậu bé (nền trắng): 7981 pixel viền được tách; ghép lên nền tối thì hết viền răng cưa trắng quanh nét đen ở tóc và bàn tay, màu bên trong giữ nguyên.
- Test mới cho viền pha 50%, mảng da chạm nền và `matte: 0`. 56/56 test qua.

### 2026-10-31 (tiếp 14)

- Thử trên art vé của người dùng (`~/Downloads/spine/Tickets`, không commit). Bản đầu tự nghĩ (vé bay vào, nổi, lật bằng `scaleX`) chưa đạt. Đọc file mẫu `Ticket.spine` (export JSON bằng Spine CLI, render khung bằng Spine) thì thấy kỹ thuật thật: vé trước là mesh chỉ có viền (50 đỉnh), gắn 6 xương dải dọc chiều dài, mỗi đỉnh 4–6 xương với trọng số trải rộng; từng xương lần lượt (cách nhau 2 frame) dời sang đầu kia và lật `scaleX` về -1 nên vé cuộn qua như trang giấy rồi cuộn về. Vé sau là mesh trên chuỗi xương uốn sóng, tối màu khi vé trước lật; bóng mờ đi; vé trước phóng to 1.78; vệt sáng vàng additive và bản sao additive chớp đỏ.
- Dựng lại bằng tool rydspine (project `ticket-flip`): Spine render ra gần như trùng khung với mẫu. Khác còn lại: vệt sáng của mẫu là mesh kéo bằng deform, rydspine chưa có tool key deform nên dùng xoay/scale xương.
- Ba lỗ hổng tool lộ ra và đã sửa:
  - `mesh_generate` dựng lại được mesh đã có (khôi phục vị trí ảnh bằng khớp affine từ UV sang toạ độ setup); từ chối nếu mesh có key deform. Trước đây phải revert và mất hết animation.
  - `mesh_generate` thêm `smooth` (px): trọng số trải giữa các xương lân cận (`1/(d²+smooth²)`). Mặc định 0 giữ như cũ (mỗi đỉnh gần như theo một xương), làm giấy/vải uốn bị rách răng cưa.
  - `validate` không còn coi là lỗi khi mesh gập lúc có xương lật gương (lật trang có chủ ý): ghi "turns over" vào info. Gập do xoay quá tay vẫn là lỗi.
- Test mới `test/mesh.test.ts` (dựng lại giữ chỗ, smooth trải trọng số, lật trang qua validate). 57/57 test qua.

### 2026-10-31 (tiếp 15)

- Tool mới `anim_deform_keys`: key deform cho mesh (thường hoặc có trọng số). Mỗi key là danh sách phép biến đổi trong toạ độ thế giới, áp lần lượt lên hình setup: `scaleX` theo trục `angle` và `scaleY` vuông góc, `rotate`, rồi dời `x`/`y` quanh `pivot` (mặc định tâm mesh); `radius` giới hạn phép biến đổi vào các đỉnh gần pivot, mờ dần theo cosine (dùng làm tay nắm kéo một chỗ). Tool đổi độ dời thế giới thành offset Spine: với mesh có trọng số, mỗi xương ảnh hưởng nhận cùng độ dời đổi về không gian của nó, nên tổng có trọng số đúng bằng độ dời. Offset 0 ở đầu/cuối được cắt (`offset`); `ease` thành curve 0..1 của deform.
- `property: "scale"` trong `anim_set_keys`/`anim_tween`/`anim_oscillate`/`anim_bounce` key cả `scalex` và `scaley` cùng lúc.
- Áp lên `ticket-flip`: vệt sáng thành mesh, 5 key deform chuyển từ key của mẫu (mỗi đỉnh mẫu thành một tay nắm `radius` 300). Spine import và render: vệt vàng quét thành dải dài ngang vé như mẫu.
- Test mới `test/deform.test.ts` (kéo dãn mesh thường và có trọng số trên xương xoay/scale, khớp từng đỉnh; ease; radius; mesh có deform không dựng lại được; `scale` hai trục). 59/59 test qua.

## Việc tiếp theo

1. Nghiệm thu trên art của chính người dùng khi có (đã đạt trên art rồng của Spine: `npm run real:art`).
3. Tách ảnh phẳng: đã có bản đầu và đã khử quầng viền. Có thể làm tiếp: AI gợi ý polygon tự động, vẽ bù tốt hơn (inpaint bằng model ảnh).
