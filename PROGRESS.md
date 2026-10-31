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
| 7. Đầu ra & nghiệm thu | 🟡 Một phần | Bộ 6 asset nghiệm thu chạy tự động và đạt hết kiểm tra, nhưng dùng art tự vẽ. Cả 6 asset đã qua vòng Spine Editor 4.3.26 thật (`npm run spine:check`). Chưa nghiệm thu trên art thật |

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

### 2026-10-31 (tiếp 7)

- Tool `shape_add`: attachment `point` (vị trí, hướng theo world, đi theo xương), `boundingbox` và `clipping` trong slot mới. Hình là các điểm world, hoặc `around` dò viền ảnh (region) hay viền hull (mesh) của một slot, `padding` nới ra. Clipping che các slot từ `from` tới `end` và được đặt ngay dưới `from`; key thứ tự vẽ được tính lại (slot mới nằm ngay dưới slot phía trên nó trong setup).
- Path constraint nhận `pathBones` (và `maxInfluences`, mặc định 2): mỗi điểm của đường cong gắn trọng số vào các xương điều khiển gần nhất, tay nắm theo trọng số của điểm. Từ chối xương thuộc chính chuỗi được path kéo (vòng lặp). Tách phần tính trọng số dùng chung với `mesh_generate`.
- `preview` (khi hiện xương) vẽ bounding box nét đứt và point.
- `spine:check` so thêm đỉnh của mọi attachment dạng đỉnh (bounding box, clipping, path) và vị trí/hướng của point.
- Asset nghiệm thu: `tree` có dây leo treo trên nhánh, path gắn vào nhánh và xương đầu dây; `chest` có point `coin-spawn` trên nắp, vùng va chạm dò theo thân rương và clipping cho quầng sáng.
- Test: 44 test đạt. `spine:check` 7/7, lệch ≤ 0,0011.

## Việc tiếp theo

1. Nghiệm thu trên art thật khi có asset; xác nhận animation chạy đúng trong Spine Editor.
2. `mirror_animation` / `mirror_bones`; pivot theo layer `[pivot]` khi import PSD (ý tưởng từ `REFERENCES.md`).
3. Tách ảnh phẳng thành bộ phận (để sau v1).
