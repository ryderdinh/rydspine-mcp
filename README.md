# rydspine-mcp

MCP server dựng rig và animation Spine 4.3 từ yêu cầu bằng ngôn ngữ tự nhiên. Không cần cài Spine Editor: server tạo trực tiếp dữ liệu Spine và kiểm tra bằng runtime Spine 4.3 chính hãng.

- Tiến độ: [`PROGRESS.md`](PROGRESS.md)
- Kế hoạch: [`PLAN.md`](PLAN.md)
- Yêu cầu: [`REQUIREMENTS.md`](REQUIREMENTS.md)

## Cài đặt

Cần Node 20+.

```bash
npm install
npm test
```

## Dùng với Claude Code

Repo có sẵn `.mcp.json`, nên Claude Code mở trong thư mục này sẽ tự nhận server `rydspine`. Với client MCP khác, chạy server qua stdio:

```bash
npx tsx src/index.ts
```

Dự án được lưu trong `workspaces/` (đổi bằng biến `RYDSPINE_WORKSPACES`); thư mục này không commit lên git.

## Quy trình

1. `project_create`: tạo dự án; hoặc `project_import` để mở project Spine 4.3 có sẵn.
2. `psd_import` hoặc `image_import`: đưa các bộ phận vào, mỗi phần nằm đúng vị trí của nó.
3. `rig_template` (chuỗi, bản lề, bánh xe, chi IK, nhân vật 2 chân) hoặc `bone_add` (`space: "world"`): đặt xương tại các khớp trên hình.
4. `slot_update`: gắn bộ phận vào xương; hình giữ nguyên vị trí.
5. `mesh_generate` (mặc định bám theo viền ảnh), `constraint_add`: thêm phần uốn cong, IK, physics.
6. `anim_create`, rồi `anim_oscillate` / `anim_tween` / `anim_bounce` / `anim_set_keys`.
7. `validate` → `preview` → `export`.

Mỗi thao tác lưu thành một phiên bản: `history_list` để xem, `history_revert` để quay lại, `lock_set` để khóa phần đã duyệt.

**Đầu ra của `export`:** `<tên>.json`, `<tên>.atlas`, `<tên>.png` dùng cho runtime Spine 4.3, và `<tên>.html` để xem animation trên trình duyệt. Người có Spine mở file JSON bằng **File → Import Data** để có project `.spine`.

**Quy ước tọa độ:** trục y hướng lên, đơn vị pixel, góc tính bằng độ ngược chiều kim đồng hồ. Giá trị animation là độ lệch so với setup pose; riêng `scalex`/`scaley` là hệ số nhân.
