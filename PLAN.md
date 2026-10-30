# rydspine-mcp — Kế hoạch triển khai

Trạng thái: Đề xuất, dựa trên `REQUIREMENTS.md`. Các mục ghi "(đề xuất)" là lựa chọn mặc định để bắt đầu. Có thể đổi sau khi chốt mục 10 của `REQUIREMENTS.md`.

## 1. Phạm vi phiên bản đầu (v1)

**Đề xuất làm trong v1:**

- Đầu vào: PSD nhiều layer, bộ PNG đã tách bộ phận, skeleton JSON 4.3 có sẵn, mô tả chuyển động bằng văn bản.
- Asset: nhân vật 2 chân, sinh vật có cánh/đuôi (chuỗi đốt), cây/vật mềm, vật có bản lề (rương), xe có bánh, logo/hình độc lập.
- Rig: bones, slots, attachments (region + mesh), auto weights, IK, transform và physics constraints.
- Animation: tạo từ mô tả, có lặp hoặc không lặp, chỉnh tham số, kết hợp nhiều chuyển động.
- Đầu ra: skeleton JSON, atlas, PNG, project `.spine` (qua Spine CLI), preview HTML/GIF, báo cáo.

**Để sau v1:**

- Tách bộ phận từ ảnh phẳng và vẽ bù phần bị che.
- Tham chiếu chuyển động từ video.
- Điều khiển Spine Editor đang mở. v1 xử lý hoàn toàn qua file.
- Path constraints phức tạp, skins nâng cao. v1 chỉ hỗ trợ thay attachment cơ bản.

## 2. Kiến trúc tổng quát

```
MCP client (Claude, ...)  ── stdio ──►  rydspine-mcp server (Node/TypeScript)
                                          ├─ tools/        : các MCP tool (API công khai)
                                          ├─ model/        : mô hình skeleton nội bộ (typed, khớp JSON 4.3)
                                          ├─ ops/          : thao tác chỉnh sửa có kiểm tra (rig, anim)
                                          ├─ import/       : PSD, PNG, JSON → model
                                          ├─ rig/          : template rig, auto mesh, auto weights, IK
                                          ├─ motion/       : thư viện chuyển động & bộ ghép
                                          ├─ validate/     : kiểm tra dữ liệu + kiểm tra chuyển động
                                          ├─ preview/      : render bằng spine runtime 4.3 (headless)
                                          ├─ export/       : JSON, atlas packing, Spine CLI → .spine
                                          └─ store/        : workspace, lịch sử phiên bản, khóa
```

Nguyên tắc:

1. **LLM suy luận, server thực thi.** Client LLM đọc ảnh và mô tả rồi chọn cấu trúc và tham số. Server cung cấp thao tác có kiểu, hợp lệ, có thể hoàn tác. Server không tự gọi LLM, nên có thể đổi model, kiểm soát chi phí và test được.
2. **Mọi thay đổi đi qua `ops/`.** Mỗi op là một bước nguyên tử, được kiểm tra hợp lệ, ghi vào nhật ký. Nhờ đó có undo, so sánh phiên bản, khóa phần đã duyệt và chỉnh đúng phạm vi.
3. **Xử lý theo file.** Định dạng nguồn là skeleton JSON 4.3. Project `.spine` sinh ra bằng Spine CLI (import JSON). Khi người dùng sửa trong Spine, họ export JSON để server nhập lại.
4. **Kiểm tra bằng runtime thật.** Mọi kết quả được nạp bằng `spine-core` 4.3 trước khi báo thành công.

**Công nghệ (đề xuất):** TypeScript, `@modelcontextprotocol/sdk`, `@esotericsoftware/spine-core` / `spine-webgl` 4.3, `ag-psd` (đọc PSD), `sharp` (xử lý ảnh), Playwright (render preview headless), Vitest (test).

## 3. Bộ MCP tool dự kiến

| Nhóm | Tool | Mô tả |
|---|---|---|
| Workspace | `project_create`, `project_open`, `project_status` | Tạo hoặc mở workspace, xem tóm tắt hiện trạng |
| Đầu vào | `import_psd`, `import_png_set`, `import_skeleton_json` | Nạp asset và tạo slots/attachments ban đầu |
| Phân tích | `asset_describe`, `asset_get_image`, `analysis_set` | Trả ảnh/bounding box/layer cho LLM, lưu kết quả phân tích (bộ phận, quan hệ, pivot) để người dùng sửa |
| Rig | `rig_apply_template`, `bone_add/update/remove`, `slot_*`, `attachment_*`, `mesh_generate`, `weights_auto`, `constraint_add` (ik/transform/physics), `skin_*`, `pose_test` | Dựng và chỉnh rig |
| Animation | `anim_create`, `anim_apply_motion` (dùng primitive), `anim_set_keys`, `anim_retime`, `anim_scale_amplitude`, `anim_offset`, `anim_layer` | Tạo và chỉnh animation |
| Chỉnh sửa | `history_list`, `history_diff`, `history_revert`, `lock_set`, `lock_clear` | Phiên bản và khóa |
| Kiểm tra | `validate`, `motion_check`, `preview_render` | Lỗi dữ liệu, lỗi chuyển động, ảnh/GIF/HTML preview |
| Đầu ra | `export_runtime` (JSON/binary + atlas), `export_spine_project`, `report` | Xuất file và báo cáo |

Tham số chung cho chỉnh sửa có phạm vi: `bones[]`, `slots[]`, `animation`, `timeRange`. Op đụng vào phần đang bị khóa sẽ bị từ chối, kèm thông báo rõ phần nào bị khóa.

## 4. Dựng rig

- **Template rig** theo loại cấu trúc: `biped`, `quadruped`, `winged`, `chain` (đuôi, cổ, rắn, dây), `hinge` (nắp, cửa), `wheeled`, `plant` (thân và nhánh), `prop/logo`. Template là khung tham số, khớp vào asset theo bounding box và pivot mà LLM đề xuất.
- **Mesh tự động:** lấy contour từ alpha → đơn giản hóa → tam giác hóa, có tham số mật độ.
- **Auto weights:** theo khoảng cách tới đoạn xương, có làm mượt và giới hạn số bone mỗi vertex.
- **IK** cho chân/tay. **Physics constraints** (tính năng của 4.2+) cho tóc, đuôi, nhánh cây, giúp có chuyển động phụ mà không cần key tay.
- `pose_test`: áp pose thử (gập, xoay cực hạn), render và báo vùng biến dạng bất thường.

## 5. Tạo animation

Một thư viện **motion primitive** có tham số. LLM ghép các primitive theo mô tả, thay vì sinh keyframe thô:

- Chu kỳ: `walk_cycle`, `run_cycle`, `flap`, `wheel_roll`, `sway`, `breathe`, `idle_bob`.
- Hành động: `swing` (vung), `open_hinge`, `appear` (scale/alpha), `bounce_settle`, `stop`.
- Bổ trợ: `follow_through` (trễ theo chuỗi xương), `anticipation`, `overshoot`, `noise`.
- Tham số chung: `duration`, `speed`, `amplitude`, `delay`, `easing`/curve, `loop`.
- **Ghép:** tuần tự trên timeline (chạy → dừng → vung kiếm) và song song theo nhóm bone (vỗ cánh + cổ + đuôi).
- **Vòng lặp liền:** primitive chu kỳ khớp key đầu và cuối, có kiểm tra liên tục của vận tốc.
- **Keyframe tay:** vẫn mở qua `anim_set_keys` cho động tác riêng. Người dùng có thể lưu thành primitive mới để mở rộng bộ hành động.

## 6. Kiểm tra và preview

- `validate`: schema JSON 4.3, tham chiếu hỏng, thiếu ảnh, weights không chuẩn hóa, vòng cha–con, nạp thử bằng `spine-core`.
- `motion_check` (lấy mẫu theo frame bằng runtime):
  - trượt chân: vận tốc điểm tiếp đất khi đang chạm đất;
  - tách khớp và biến dạng: độ giãn cạnh mesh, khoảng cách khớp;
  - giật ở điểm nối vòng lặp: chênh lệch vị trí và vận tốc giữa frame cuối và frame đầu;
  - vượt biên độ đã yêu cầu.
- `preview_render`: Playwright + `spine-webgl` render frame hoặc GIF/contact sheet, có overlay bones/mesh/weights. Kèm một trang HTML player để tua và xem từng thời điểm.

## 7. Phiên bản, khóa và vòng làm việc với Spine

- Workspace gồm `skeleton.json` hiện tại, `images/`, `ops.log` và các snapshot. Mỗi lần gọi tool tạo một phiên bản.
- `history_diff` so sánh theo bone, slot và animation. `history_revert` quay lại một phiên bản bất kỳ.
- Khóa theo bone, slot, animation hoặc khoảng thời gian.
- Nhập lại JSON sau khi người dùng sửa trong Spine: so khớp theo tên và ghi thành một phiên bản "manual edit".

## 8. Lộ trình

| Giai đoạn | Nội dung | Kết quả kiểm chứng |
|---|---|---|
| **0. Spike & chốt** (~1 tuần) | Xác nhận định dạng JSON 4.3; thử Spine CLI import JSON → `.spine` và export (cần license, kiểm tra bản Essential/Professional); nạp JSON bằng `spine-core` 4.3 trong Node; render headless; chốt các điểm ở mục 10 | Một skeleton viết tay đi trọn vòng JSON → `.spine` → mở được trong Spine 4.3 → render |
| **1. Lõi** | Khung MCP server, model, ops, store/history, `validate`, `export_runtime` | Test round-trip JSON; tạo skeleton tối thiểu bằng tool |
| **2. Đầu vào** | `import_psd`, `import_png_set`, `import_skeleton_json`, atlas packing, tool phân tích | PSD mẫu → slots/attachments đúng thứ tự và vị trí |
| **3. Rig** | bone/slot ops, template rig, mesh và auto weights, IK, physics, `pose_test` | Rig được 6 asset mẫu, pose thử không lỗi |
| **4. Animation** | Motion primitive, ghép, curves, loop, chỉnh tham số | Sinh đủ 6 animation mẫu ở mục 5 của `REQUIREMENTS.md` |
| **5. Kiểm tra & preview** | `motion_check`, `preview_render`, HTML player | Phát hiện đúng lỗi trên bộ case cố ý làm hỏng |
| **6. Chỉnh sửa** | Chỉnh có phạm vi, khóa, diff/revert, nhập lại JSON từ Spine | Chỉnh một phần không làm đổi phần còn lại (so diff) |
| **7. Đầu ra & nghiệm thu** | `export_spine_project`, `report`, chạy bộ nghiệm thu | Đạt tiêu chí mục 9 của `REQUIREMENTS.md` |

Tiến độ giai đoạn 0: xem `spike/README.md`. Đã chạy được runtime 4.3 headless; còn chờ chạy thử Spine CLI trên máy người dùng.

Giai đoạn 2 và 3 có thể làm song song sau khi lõi xong. Giai đoạn 5 nên bắt đầu sớm ở mức tối thiểu (render frame) để dùng kiểm tra cho giai đoạn 3–4.

## 9. Bộ nghiệm thu đề xuất

Sáu asset mẫu, mỗi asset có đầu vào, prompt, thông số mong đợi và ngưỡng kiểm tra tự động:

1. Nhân vật (PSD): chạy → dừng → vung kiếm. Không trượt chân quá ngưỡng.
2. Rồng (PNG set): vỗ cánh lặp, cổ và đuôi trễ pha. Vòng lặp liền.
3. Cây (PSD): nghiêng theo gió, các nhánh lệch pha. Không biến dạng mesh quá ngưỡng.
4. Rương (PNG set): mở nắp quanh bản lề rồi nảy nhẹ. Pivot đúng bản lề.
5. Xe (PNG set): bánh lăn khớp quãng đường, thân nhún.
6. Logo (PNG): xuất hiện, nảy, ổn định. Không lặp.

Ngoài kiểm tra tự động, mỗi mẫu cần người duyệt bằng mắt dựa trên preview. Tiêu chí chất lượng hình ảnh cần mẫu tham chiếu đã thống nhất.

## 10. Rủi ro

- **Spine CLI và license:** người dùng có license Spine Professional. Lưu ý: mesh, weights, IK và physics cần bản Professional. Server cần chạy trên máy đã cài và kích hoạt Spine Editor để gọi CLI. Key không được commit vào repo; nếu cần chạy CI thì đưa vào biến môi trường hoặc secret.
- **Thay đổi định dạng 4.3:** đã xác nhận JSON 4.3 gộp các constraint vào một mảng `constraints` có `type`. Ghim `spine-core` 4.3.13 và chỉnh lại khi biết phiên bản Editor chính xác.
- **Chất lượng tự động:** pivot và weights tự động có thể sai với asset lạ. Giảm thiểu bằng bước duyệt kết quả phân tích, `pose_test` và chỉnh tay qua tool.
- **Chất lượng chuyển động chủ quan:** cần mẫu tham chiếu và ngưỡng cụ thể trước nghiệm thu.

## 11. Bảo mật thông tin

- **License Spine:** không đưa key vào chat, repo, log hay file cấu hình được commit. Key chỉ dùng để kích hoạt Spine Editor trên máy người dùng. Server gọi Spine CLI đã kích hoạt sẵn và không đọc hay lưu key.
- **Secret khác** (nếu có): chỉ đọc từ biến môi trường hoặc file `.env` cục bộ (đã nằm trong `.gitignore`). Repo chỉ giữ `.env.example` không chứa giá trị thật.
- **Asset của người dùng** (PSD, PNG, project): nằm trong thư mục workspace cục bộ, không commit. Bộ nghiệm thu chỉ dùng asset mẫu được phép công khai trong repo.
- **Chạy cục bộ:** MCP server chạy qua stdio trên máy người dùng và không mở cổng mạng. Server không gửi dữ liệu ra ngoài; phần ảnh LLM nhìn thấy chỉ là ảnh mà client tự yêu cầu qua tool.
- **Log và báo cáo:** không ghi đường dẫn tuyệt đối nhạy cảm hay nội dung secret; xóa thông tin môi trường khỏi báo cáo lỗi.
- **Repo:** để ở chế độ private. Trước mỗi lần push, kiểm tra không có secret (bật secret scanning của GitHub).

## 12. Cần người dùng xác nhận trước giai đoạn 1

1. Phạm vi v1 ở mục 1 (đặc biệt: loại ảnh phẳng ra khỏi v1).
2. ~~License Spine?~~ Professional. Còn cần: phiên bản 4.3.x cụ thể và hệ điều hành của máy chạy server.
3. Runtime đích (web, Unity, Godot, ...)?
4. Mức tự động hóa: dừng ở bước phân tích để người dùng duyệt, hay chạy thẳng tới animation?
5. Stack TypeScript/Node có phù hợp không?
