# rydspine-mcp

MCP server dựng rig và animation Spine 4.3 từ yêu cầu bằng ngôn ngữ tự nhiên. Không cần cài Spine Editor: server tạo trực tiếp dữ liệu Spine và kiểm tra bằng runtime Spine 4.3 chính hãng.

- Tiến độ: [`PROGRESS.md`](PROGRESS.md)
- Kế hoạch: [`PLAN.md`](PLAN.md)
- Yêu cầu: [`REQUIREMENTS.md`](REQUIREMENTS.md)

## Cài đặt

**Người dùng:** mở trang [`docs/index.html`](docs/index.html) (GitHub Pages), tải bộ cài cho macOS hoặc Windows và bấm đúp. Bộ cài tải mã nguồn vào `~/.rydspine/app` rồi chạy trình cài đặt `src/setup.ts`, trình này ghi cấu hình MCP cho Claude Code, Claude Desktop và Codex. Chạy lại để cập nhật. Đóng gói lại bộ cài sau khi sửa `installer/`: `npm run installers`.

**Phát triển:** cần Node 20+.

```bash
npm install
npx playwright install chromium   # cho ảnh preview PNG và test trang player
npm test
```

## Dùng với Claude Code

Repo có sẵn `.mcp.json`, nên Claude Code mở trong thư mục này sẽ tự nhận server `rydspine`. Với client MCP khác, chạy server qua stdio:

```bash
npx tsx src/index.ts
```

Dự án được lưu trong `workspaces/` (đổi bằng biến `RYDSPINE_WORKSPACES`); thư mục này không commit lên git.

## Quy trình

1. `project_create`: tạo dự án; hoặc `project_import` để mở project Spine 4.3 có sẵn (JSON hoặc `.skel`).
2. `psd_import` hoặc `image_import`: đưa các bộ phận vào, mỗi phần nằm đúng vị trí của nó. Trong PSD, layer `<tên>[pivot]` (một chấm nhỏ, ẩn cũng được) đặt xương cho layer hoặc nhóm `<tên>` nằm cạnh nó; `[pivot]` nằm trong một nhóm là xương của nhóm đó. Xương lồng nhau theo nhóm, và mỗi bộ phận gắn vào xương gần nhất.
   Ảnh phẳng (một hình, chưa tách lớp): `image_inspect` trả ảnh có lưới toạ độ; `image_split` tự tách các mảng rời trên nền trong suốt hoặc nền một màu, hoặc cắt theo polygon cho từng bộ phận (liệt kê từ sau ra trước). `overlap` vẽ bù phần bị bộ phận phía trước che, chỉ trong polygon của bộ phận đó, nên hãy khoanh cả phần bị che (cổ dưới đầu, đầu đùi dưới áo) để khớp không hở khi xoay. `dryRun` chỉ trả ảnh overlay để chỉnh polygon. Với nền trắng hoặc nền một màu, viền khử răng cưa được tách khỏi màu nền (`matte`), nên bộ phận không còn quầng sáng khi đặt lên nền khác.
3. `rig_template` (chuỗi/cánh, bản lề, bánh xe, chi IK, 2 chân, 4 chân) hoặc `bone_add` (`space: "world"`): đặt xương tại các khớp trên hình.
4. `slot_update`: gắn bộ phận vào xương; hình giữ nguyên vị trí.
5. `mesh_generate` (mặc định bám theo viền ảnh), `constraint_add`: thêm phần uốn cong, IK, transform, physics, path (đưa các điểm trên hình, rydspine tự tạo đường cong; `pathBones` gắn đường cong vào vài xương điều khiển) và slider (phát animation theo một xương điều khiển). `shape_add`: điểm mốc cho game (`point`: nòng súng, tay cầm), vùng va chạm (`boundingbox`) hoặc mặt nạ (`clipping`), từ các điểm trên hình hoặc tự dò theo viền của một slot (`around`).
6. `mirror_bones`: chép một bên rig sang bên kia (xương, slot, ảnh lật, IK, physics). `mirror_animation`: đổi animation sang bên kia (`swap` cho nhìn ngang, `mirror` phản chiếu cho nhìn thẳng).
6. `skin_create` / `skin_variant` nếu cần nhiều bộ trang phục.
7. `anim_create`, rồi `anim_oscillate` / `anim_tween` / `anim_bounce` / `anim_gait` / `anim_set_keys` / `anim_slot_keys`. Constraint thay đổi theo thời gian (vị trí trên path, gió physics, mix, time của slider): `anim_constraint_keys`. Hiệu ứng nhiều frame (lửa, lấp lánh): `sequence_import` rồi `anim_sequence_keys`. Event cho game (bước chân, va chạm, âm thanh): `event_define` và `anim_event_keys`. Đổi lớp trước/sau giữa animation: `anim_draw_order_keys`. Mọi `ease` nhận preset hoặc bezier kiểu CSS `[x1, y1, x2, y2]`.
8. `validate`, `motion_check` → `preview` → `export`.

## Giao diện

Chạy `npm run ui` (hoặc gọi tool `ui_open`) rồi mở http://127.0.0.1:5180. Trang **rydspine studio** phát animation của mọi dự án bằng player Spine, và hiện kết quả kiểm tra, cây xương, lịch sử phiên bản cùng dải khung hình.

## Bộ nghiệm thu

Chạy `npm run acceptance` để dựng 8 asset mẫu (nhân vật, rồng, cây, rương, xe, logo, đèn lồng, cua) qua tool MCP. Kết quả nằm trong `acceptance/out/`: file xuất cho từng asset, `report.json` và trang `studio-local.html`.

Chạy `npm run real:art` để nghiệm thu trên art thật: con rồng trong bộ ví dụ của Spine (art của Thiago Brayner, chỉ dùng để trình diễn). Script dựng PSD giống file họa sĩ giao (layer phẳng, marker `[pivot]`), rig và làm animation bay hoàn toàn qua tool MCP, rồi so tư thế setup với bản gốc theo từng điểm ảnh. Có `SPINE_CLI` thì kiểm thêm vòng qua Spine Editor. Art chỉ nằm trong `~/.cache` và `acceptance/out/`, không commit hay đăng lên đâu.

Chạy `npm run spine:check` để kiểm 8 asset bằng Spine Editor thật: Spine import từng file JSON, xuất lại, rồi runtime so hai bản từng khung; Spine cũng vẽ dải khung hình cho mỗi animation. Cần đặt `SPINE_CLI` trỏ tới Spine (ví dụ `/Applications/Spine.app/Contents/MacOS/Spine`), hoặc trên Linux đặt `SPINE_ACTIVATION_CODE` để script tự tải Spine. Thiếu cả hai thì bỏ qua.

Chạy `npm run skel:examples` để kiểm phần đọc `.skel` trên bộ ví dụ chính thức của Spine (tải thưa từ `github.com/EsotericSoftware/spine-runtimes`, nhánh 4.3): mỗi file được chuyển sang JSON rồi so với runtime đọc thẳng `.skel`, từng khung. `npx tsx acceptance/skel-fixture.ts` tạo lại `test/fixtures/features` bằng Spine thật.

Skill `.claude/skills/spine-rigging` hướng dẫn agent rig theo cách các dự án ví dụ của Spine làm (cách chọn constraint, thông số physics điển hình). Claude Code tự nạp khi mở repo này; muốn dùng ở nơi khác thì chép thư mục đó vào `~/.claude/skills/`.

Mỗi thao tác lưu thành một phiên bản: `history_list` để xem, `history_diff` để so sánh, `history_revert` để quay lại, `lock_set` để khóa phần đã duyệt. Sau khi sửa trong Spine Editor và export lại JSON, dùng `project_sync` để đưa bản sửa về thành phiên bản mới.

**Đầu ra của `export`:** `<tên>.json`, `<tên>.atlas`, `<tên>.png` dùng cho runtime Spine 4.3, và `<tên>.html` để xem animation trên trình duyệt. Người có Spine mở file JSON bằng **File → Import Data** để có project `.spine`.

**Quy ước tọa độ:** trục y hướng lên, đơn vị pixel, góc tính bằng độ ngược chiều kim đồng hồ. Giá trị animation là độ lệch so với setup pose; riêng `scalex`/`scaley` là hệ số nhân.

Các dự án tham khảo (runtime chính thức, MCP Spine của cộng đồng): `REFERENCES.md`.
