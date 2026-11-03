# EAL Investment Desk API

Node.js (Express 4) + MongoDB (Mongoose 8) cho app Flutter EAL Investment Desk. Toàn bộ dữ liệu, enum và thông báo là **tiếng Anh** (bảng đối chiếu với enum tiếng Việt của spec: mục 6 trong docs/API.md). Dựa trên [docs/API Spec - EAL Investment Desk (cho Backend).md](docs/API%20Spec%20-%20EAL%20Investment%20Desk%20(cho%20Backend).md).
Cùng kiến trúc với EALIM Metals API: một engine CRUD chung cho 21 module, entry Vercel trong `api/`, test trên MongoDB in-memory.
Tài liệu tích hợp cho app: [docs/API.md](docs/API.md).

```bash
cp .env.example .env     # đặt MONGODB_URI
npm install
npm run db:init          # tạo database, 27 collection, index, hồ sơ công ty (chạy lại an toàn)
npm run seed:sample      # (tùy chọn, chỉ dev) dữ liệu mẫu; thêm `-- --reset` để xóa dữ liệu cũ trước
npm run dev              # http://localhost:4000  -> /health, /v1/...
npm test                 # MongoDB replica set in-memory (dùng mongod local nếu có)
```

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/models/records.js` | 21 collection nghiệp vụ: trường, nhãn tiếng Việt, enum, khóa ngoại + quy tắc xóa (`onDelete`) |
| `src/models/system.js` | `history`, `content_reports`, `contents`, `occupancy_snapshots`, `settings` (+ `idempotency_keys`) |
| `src/resources/index.js` | Đăng ký module + quy tắc server mục 4 (chuẩn hóa tháng, `cap`, `rents.status`, `doneDate`...) |
| `src/core/` | Engine: registry, record pipeline (validate → FK → prepare → khóa kỳ → lưu + lịch sử), list/filter/cursor, cascade, router |
| `src/services/` | actions (`:bulkDelete`, `:renew`, `:revert`...), analytics, alerts/queue/timeline, job hằng ngày |
| `src/lib/guard.js` | Bộ lọc dữ liệu nhạy cảm (SSN, thẻ, số tài khoản, email, điện thoại) |

## Cấu hình

Xem [.env.example](.env.example): `TIMEZONE`, `LOCK_MONTHS`, `API_KEY` (bật khi chạy thật), `ADMIN_KEY` (sửa nội dung công ty / pháp lý, chốt kỳ), `CRON_SECRET`.

Transaction (cascade delete, renew, bulk delete) cần replica set — Atlas có sẵn. Trên `mongod` standalone vẫn chạy nhưng không atomic.

## Deploy (Vercel)

`vercel.json` chuyển mọi request vào `api/index.js` (cache kết nối MongoDB). Đặt `MONGODB_URI`, `API_KEY`, `CRON_SECRET`, rồi chạy `MONGODB_URI=... npm run db:init` một lần. Vercel Cron gọi `/v1/jobs/daily` mỗi ngày (làm mới trạng thái tiền thuê, snapshot tỷ lệ lấp đầy).
