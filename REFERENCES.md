# Tham khảo

Các dự án có thể học theo khi nâng cấp rydspine. Đọc mã của họ để lấy ý tưởng, không chép nguyên văn; giấy phép ghi bên cạnh.
Cập nhật file này khi tìm được nguồn mới.

## Spine chính thức

- **[EsotericSoftware/spine-runtimes](https://github.com/EsotericSoftware/spine-runtimes)** (nhánh 4.3). Runtime chuẩn
  (`spine-ts/spine-core` là thư viện rydspine dùng) và `examples/*/export`: ~30 dự án mẫu (spineboy, raptor, mix-and-match,
  stretchyman, tank, vine, sack, celestial-circus, diamond…) dạng `.json` + `.skel`.
  - `npm run skel:examples` tải và kiểm phần đọc `.skel` trên toàn bộ mẫu.
  - Cách rig rút ra từ mẫu: `.claude/skills/spine-rigging/SKILL.md`.
  - `SkeletonJson.js` / `SkeletonBinary.js` trong `node_modules/@esotericsoftware/spine-core/dist` là chuẩn cho định dạng
    (giá trị mặc định, thứ tự kênh của curve…).

## MCP cho Spine của cộng đồng (xem ngày 2026-10-31)

| Dự án | Ngôn ngữ, giấy phép | Cập nhật | Điểm đáng học |
|---|---|---|---|
| [UmutFarukDilli/spine-mcp](https://github.com/UmutFarukDilli/spine-mcp) | Python, MIT | 2026-10 | Gần rydspine nhất: sửa JSON, dùng Spine CLI để chuyển đổi, test bằng spine-core 4.3. Một tool `spine_set_keyframes` cho mọi timeline (cả `event`, `drawOrder`, `rgba2/rgb2`, `inherit`). Curve nhận preset hoặc bezier chuẩn hoá kiểu CSS `[cx1,cy1,cx2,cy2]`, tự đổi sang bezier tuyệt đối và giữ dáng khi thêm key. `spine_validate` bắt key không sắp xếp, curve vượt khoảng, trường runtime bỏ qua, bố cục constraint 4.2 với 4.3. Có `spine_upgrade`, `spine_doctor`, attachment `point` / `boundingbox`, event. |
| [zhoushengmin/spine-mcp-server](https://github.com/zhoushengmin/spine-mcp-server) | TypeScript, chưa ghi giấy phép | 2026-08 | Spine 3.8 + Cocos Creator, ~70 tool. Ý tưởng tool: `mirror_bones`, `mirror_animation`, `mix_animations`, `pose_to_animation`, `apply_effect` (thư viện hiệu ứng), `mesh_wave`, `export_sheet` / `export_video`, `scale_project`, `batch_rename`, `rollback`, `cut_parts`, `repack_atlas`. |
| [egorfedorov/spine-mcp](https://github.com/egorfedorov/spine-mcp) | Python, MIT | 2026-08 | Rig + animate một lệnh từ PSD hoặc thư mục xuất của PhotoshopToSpine; nhận dạng họ trạng thái đầu (mắt/miệng) theo tên layer; `batch` cho cả thư mục nhân vật; preview dạng montage PNG; output chạy được trong spine-pixi. |
| [ampersante/spine2d-animation-mcp](https://github.com/ampersante/spine2d-animation-mcp) (bản fork giống hệt: [naosen/spine2d-animation-mcp](https://github.com/naosen/spine2d-animation-mcp)) | Python, MIT | 2026-06 | PSD → Spine 4.2: pivot đặt ở mép khớp của bộ phận thay vì tâm ảnh, hoặc theo layer đánh dấu `<part>[pivot]`; quy ước tên layer → cây xương; thứ tự vẽ theo chồng layer PSD. |

Danh mục để tìm thêm: [glama.ai](https://glama.ai/mcp/servers?query=spine), [mcp.so](https://mcp.so) (tìm "spine").

## Đã lấy / có thể lấy

- Đã làm: tool key cho mọi timeline constraint (cách "kênh bỏ trống giữ giá trị setup" giống UmutFarukDilli), thêm slider
  và chuỗi ảnh (họ chưa có).
- Đã làm: key `event` và `drawOrder`, curve bezier chuẩn hoá kiểu CSS cho mọi `ease` (theo UmutFarukDilli).
- Nên làm: `mirror_animation` / `mirror_bones`;
  pivot theo layer đánh dấu `[pivot]` trong `psd_import`; attachment `point` / `boundingbox`.
