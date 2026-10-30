# Giai đoạn 0 — Spike

Mục tiêu: chứng minh vòng **skeleton JSON → `.spine` → export → runtime 4.3** chạy được trước khi viết phần lõi.

## Nội dung

- `fixtures/swing/`: skeleton mẫu viết tay theo định dạng JSON 4.3. Gồm 7 bones, 4 slots, region và mesh có weights, IK constraint, physics constraint, 2 animation (`sway` lặp có bezier curve, `reach` di chuyển IK target), kèm ảnh và atlas.
- `runtime-check.ts`: nạp skeleton bằng `@esotericsoftware/spine-core` 4.3.13 rồi kiểm tra:
  - mọi attachment đều có ảnh;
  - mọi bone giữ giá trị hữu hạn khi chạy animation có physics;
  - điểm nối vòng lặp không bị giật;
  - IK chạm target.
- `spine-roundtrip.ps1` (Windows) / `spine-roundtrip.sh` (macOS): gọi Spine CLI trên máy bạn để import JSON thành `.spine`, export lại JSON, rồi chạy `runtime-check` trên bản export.

## Chạy

Cần Node 20+.

```bash
npm install
npm run spike:check
```

Vòng Spine CLI (trên máy đã cài và kích hoạt Spine; script không đọc license key):

```powershell
$env:SPINE_VERSION = "4.3.xx"   # số phiên bản trong Help > About
.\spike\spine-roundtrip.ps1
```

```bash
SPINE_VERSION=4.3.xx ./spike/spine-roundtrip.sh
```

Nếu Spine không nằm ở đường dẫn mặc định, đặt thêm `SPINE_EXE`. Nếu CLI báo sai tham số, chạy `Spine --help` rồi gửi lại phần output (không chứa thông tin license).

## Kết quả đến nay

- ✅ JSON viết tay nạp được bằng runtime 4.3.13. Các kiểm tra phát hiện đúng lỗi cố ý gây ra: thiếu ảnh, vòng lặp bị giật, IK không chạm target.
- ⚠️ Định dạng 4.3 khác 4.2: IK, transform, path, physics và slider constraint nằm chung trong mảng `constraints` và phân biệt bằng `type`, thay vì nằm trong các mảng `ik`, `transform`, `path`, `physics` riêng. API runtime cũng đổi (`setupPose()`, `appliedPose`, `Physics`).
- ⚠️ Runtime cần atlas thật kể cả khi chạy headless, nên khâu đóng gói atlas phải có từ giai đoạn 1–2.
- ⏳ Chưa xác nhận: tham số Spine CLI và việc mở `.spine` trong Editor. Cần chạy trên máy của bạn.
