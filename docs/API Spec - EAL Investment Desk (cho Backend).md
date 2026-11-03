# EAL Investment Desk — Đặc tả Model & API cho Backend

> Tài liệu được tổng hợp trực tiếp từ code app Flutter (`lib/data/models.dart`, `modules.dart`, `store.dart`, `analytics.dart`, `screens/queue.dart`, `screens/toolkit.dart`).
> Mục tiêu: BE xây API, app **bỏ hoàn toàn dữ liệu mẫu** (`seed.dart`, `LocalMockApi`) và chỉ đọc/ghi qua API. Mọi tên trường, giá trị enum (tiếng Việt) bên dưới là **đúng chuỗi app đang dùng** — BE trả/nhận nguyên văn, không dịch.

## 0. Quy ước chung

| Mục | Quy ước |
|---|---|
| Base URL | `https://<host>/v1` |
| Định dạng | JSON UTF-8, field `camelCase` |
| `id` | chuỗi bất kỳ do server sinh (khuyến nghị UUID). **App không hiển thị id**, chỉ dùng làm khóa liên kết |
| Tiền | `number`, đơn vị **USD**, tối đa 2 chữ số thập phân |
| Phần trăm | `number` theo thang 0–100 (ví dụ `6.5` = 6,5%) |
| Ngày | `date` = `YYYY-MM-DD` (không kèm giờ để tránh lệch múi giờ). Thời điểm (`createdAt`, `updatedAt`, `at`) = ISO 8601 UTC (`2026-11-02T08:30:00Z`) |
| Tháng | Trường `month` luôn là **ngày đầu tháng** (`2026-10-01`) |
| Diện tích | Luôn lưu **ft²**. App tự đổi sang m² khi hiển thị |
| Chuỗi rỗng / không có | Trả `null`, không trả `""` |
| Lỗi | HTTP status chuẩn + body `{ "code": "VALIDATION_ERROR", "message": "…", "fields": { "rent": "Bắt buộc" } }` (`message` tiếng Việt, app hiện nguyên văn) |
| Phân trang list | `?limit=50&cursor=<opaque>` → `{ "items": [...], "nextCursor": "…" | null, "total": 123 }` |

### 0.1 Trường hệ thống (server quản lý, client không được gửi lên)

Mọi bản ghi của mọi module đều có:

| Trường | Kiểu | Mô tả |
|---|---|---|
| `id` | string | Khóa chính |
| `createdBy` | string | Tên hiển thị của người tạo (xem mục 8 về định danh) |
| `createdAt` | datetime | |
| `updatedAt` | datetime | |
| `version` | integer | Bắt đầu = 1, **+1 mỗi lần sửa có thay đổi thật** (dùng cho kiểm soát xung đột) |

> App cũ còn trường `ref` (mã `PRP-0001`) và `reports` (số báo cáo nội dung) nhưng **UI không còn hiển thị** → BE có thể bỏ. Nếu cần mã tham chiếu nội bộ cho CSKH thì cứ giữ, app sẽ bỏ qua.

### 0.2 Kiểu trường (cột "Kiểu" ở các bảng bên dưới)

| Kiểu trong bảng | JSON | Ghi chú |
|---|---|---|
| string | string | Văn bản tự do |
| integer | number (int) | |
| number | number | |
| number (USD) | number | Tiền tệ |
| number (0–100) | number | Phần trăm |
| date | string | `YYYY-MM-DD` |
| enum | string | Chỉ nhận đúng các giá trị liệt kê; sai → 422 |
| id | string \| null | Khóa ngoại tới module nêu trong ghi chú (`→ properties`). Phải tồn tại, sai → 422 |
| integer (1–5) | number | Điểm sao |

### 0.3 Bộ lọc dữ liệu nhạy cảm (server **bắt buộc** kiểm tra lại, không chỉ tin app)

App có `Guard` chặn ở mọi trường văn bản tự do (`name`, `note`, `description`, `owner`, `inspector`, `supplier`, `related`…). BE cần cùng quy tắc, trả `422` kèm thông báo:

| Điều kiện | Thông báo (đang dùng trong app) |
|---|---|
| Khớp `\b\d{3}-\d{2}-\d{4}\b` (giống SSN) | Có chuỗi giống số an sinh xã hội — không được nhập. |
| Chuỗi 13–19 chữ số (cho phép khoảng trắng/gạch) qua Luhn | Có chuỗi giống số thẻ thanh toán — không được nhập. |
| Chuỗi ≥ 9 chữ số liền | Có chuỗi số dài giống số tài khoản — không được nhập. |
| Chứa email | Trường này không nhận địa chỉ email. |
| Chứa số điện thoại (kiểu Mỹ) | Trường này không nhận số điện thoại. |

**Ngoại lệ:** các trường đánh dấu "chỉ liên hệ chung của công ty" (`vendors.phone/email`, `partners.phone/email`) được phép chứa email/điện thoại, nhưng **vẫn chặn** SSN và số thẻ.

---

## 1. Sơ đồ quan hệ

```
portfolios 1──n properties ──┬─n units ──┬─n leases (leases.prev → leases)
                             │           ├─n rents
                             │           └─n workorders (unit tùy chọn)
                             ├─n workorders ──→ vendors
                             ├─n expenses
                             ├─n budgets
                             ├─n loans
                             ├─n revenue
                             ├─n inspections
                             ├─n sales
                             └─n renovations ──→ vendors
                                       └─n milestones
deals ──┬─n checklist
        └─n scenarios (deal tùy chọn)
deals.property → properties   (chỉ cơ hội "Bán")
tasks, targets, partners: độc lập
```

### Quy tắc xóa (cascade)

| Xóa bản ghi | Hành vi với bản ghi con |
|---|---|
| `portfolios` | `properties.portfolio` → `null` (gỡ liên kết, **không xóa** tài sản) |
| `properties` | **Xóa theo**: `units`, `leases`, `workorders`, `expenses`, `budgets`, `loans`, `revenue`, `inspections`, `renovations` (và con của chúng) |
| `units` | **Xóa theo**: `leases`, `rents`. `workorders.unit` → `null` |
| `vendors` | `workorders.vendor`, `renovations.vendor` → `null` |
| `renovations` | **Xóa theo**: `milestones` |
| `deals` | **Xóa theo**: `checklist`. `scenarios.deal` → `null` |
| Còn lại | Không có con |

> ⚠️ `sales.property` hiện **không** nằm trong cascade của app (bản ghi giao dịch đã chốt vẫn tồn tại khi xóa tài sản, tên tài sản hiển thị `—`). BE cần chốt: giữ nguyên (khuyến nghị — để bảng xếp hạng bán chạy không bị mất lịch sử) hay cho cascade.

Khi xóa, bản ghi bị xóa theo cũng bị xóa **lịch sử chỉnh sửa**; chỉ giữ 1 dòng `delete` của bản ghi gốc (xem mục 5).

---

## 2. Danh sách module & endpoint

Tất cả module dùng **cùng một bộ endpoint** `/v1/{module}`:

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/v1/{module}` | Danh sách (phân trang, lọc, sắp xếp — mục 2.2) |
| `POST` | `/v1/{module}` | Tạo mới → `201` + bản ghi đầy đủ (đã chạy chuẩn hóa mục 4) |
| `GET` | `/v1/{module}/{id}` | Chi tiết |
| `PATCH` | `/v1/{module}/{id}` | Sửa một phần. Header `If-Match: <version>`; lệch version → `409` |
| `DELETE` | `/v1/{module}/{id}` | Xóa (có cascade) → `204` |
| `GET` | `/v1/{module}/{id}/impact` | Xem trước tác động khi xóa: `{ "removed": [{ "module", "id", "label" }], "unlinked": [...] }` (app hiện trước khi xác nhận xóa) |
| `POST` | `/v1/{module}/{id}/duplicate` | Nhân bản (mục 2.3) |
| `POST` | `/v1/{module}:bulkDelete` | Xóa hàng loạt `{ "ids": [...] }`, tối đa **30** id/lần |

`{module}` ∈ `portfolios, properties, units, leases, rents, workorders, vendors, inspections, renovations, milestones, tasks, expenses, budgets, loans, revenue, targets, deals, checklist, sales, scenarios, partners` (21 module).

### 2.1 Phản hồi bản ghi

Bản ghi = các trường nghiệp vụ của module + trường hệ thống (mục 0.1), **phẳng**, ví dụ:

```json
{
  "id": "9f1c…",
  "name": "Biscayne Gardens",
  "type": "Nhà ở nhiều căn",
  "status": "Đang sở hữu",
  "portfolio": "c2a0…",
  "city": "North Miami",
  "zip": "33181",
  "units": 24,
  "value": 5200000,
  "createdBy": "Linh",
  "createdAt": "2026-05-01T03:00:00Z",
  "updatedAt": "2026-10-12T09:10:00Z",
  "version": 3
}
```

Khóa ngoại trả **id** (app tự tra tên). Để đỡ N+1 request, nên hỗ trợ `?expand=property,unit` trả thêm `propertyName`, `unitCode` … (tùy BE; app chỉ cần tên).

### 2.2 Query list

| Tham số | Ví dụ | Ý nghĩa |
|---|---|---|
| `q` | `q=biscayne` | Tìm theo tên/nhãn chính của bản ghi (xem bảng "trường nhãn" bên dưới) |
| `{field}` | `status=Đang thuê&property=<id>` | Lọc bằng nhau theo bất kỳ trường enum/id nào. Cho phép nhiều giá trị: `status=A,B` |
| `{dateKey}From` / `{dateKey}To` | `monthFrom=2026-01-01&monthTo=2026-12-31` | Lọc khoảng theo **trường ngày chính** của module (bảng 2.4) |
| `sort` | `sort=-rent` | `-` = giảm dần. Khóa sắp xếp hỗ trợ ở bảng 2.4 |
| `limit`, `cursor` | | Phân trang |
| `all=true` | | Trả toàn bộ (tối đa 2000) — **bắt buộc có** ở giai đoạn 1 vì app tính dashboard phía client (mục 6) |

**Trường nhãn chính** (app dùng để hiển thị tên bản ghi, theo thứ tự ưu tiên): `name`, `code`, `title`, `company`, `lender`, `item`, `kind`, `category`. Dùng cho `q` và cho `label` trong lịch sử.

### 2.3 Nhân bản

`POST /v1/{module}/{id}/duplicate` → tạo bản mới: sao chép mọi trường nghiệp vụ, **bỏ** trường hệ thống, và nếu có chuỗi trong thứ tự `name`, `code`, `title` thì thêm hậu tố ` (bản sao)` vào trường đầu tiên tồn tại. Không nhân bản bản ghi con.

### 2.4 Trường ngày chính, trạng thái, sắp xếp theo module

| Module | Tiêu đề trong app | Trường trạng thái | Trường ngày chính | Khóa sắp xếp (nhãn) | Khóa lọc nhanh |
|---|---|---|---|---|---|
| `portfolios` | Danh mục | — | — | — | — |
| `properties` | Tài sản | `status` | — | `value` Giá trị, `units` Số đơn vị, `name` Tên | `type` |
| `units` | Đơn vị cho thuê | `status` | — | `rent` Tiền thuê, `code` Mã, `area` Diện tích | `status` |
| `leases` | Hợp đồng thuê | `status` | `end` | `end` Ngày hết hạn, `rent` Tiền thuê | `status` |
| `rents` | Thu tiền thuê | `status` | `month` | `month` Tháng, `gap` Còn thiếu (= `due − paid`, **trường tính**) | `status` |
| `workorders` | Bảo trì | `status` | `dueDate` | `dueDate` Hạn xử lý, `estCost` Chi phí | `status` |
| `vendors` | Nhà thầu | `status` | — | — | `service` |
| `inspections` | Kiểm tra tài sản | `result` | `date` | — | `result` |
| `renovations` | Dự án cải tạo | `status` | `eta` | — | `status` |
| `milestones` | Mốc tiến độ | `status` | `due` | — | — |
| `tasks` | Việc cần làm | `status` | `due` | `due` Hạn | `status` |
| `expenses` | Chi phí | — | `date` | `date` Ngày, `amount` Số tiền | `category` |
| `budgets` | Ngân sách năm | — | — | — | `category` |
| `loans` | Khoản vay | `status` | `maturity` | `maturity` Đáo hạn, `balance` Dư nợ, `rate` Lãi suất | — |
| `revenue` | Bản ghi doanh thu | — | `month` | `month` Tháng, `amount` Số tiền | `kind` |
| `targets` | Mục tiêu doanh thu & NOI | — | — | — | `period` |
| `deals` | Giao dịch đầu tư | `stage` | — | `ask` Giá chào, `cap` Cap rate | `stage` |
| `checklist` | Checklist thẩm định | `status` | — | — | `status` |
| `sales` | Giao dịch đã chốt | — | `date` | `date` Ngày, `value` Giá trị, `qty` Số lượng | `kind` |
| `scenarios` | Kịch bản phân tích | — | — | — | `tool` |
| `partners` | Đối tác | — | — | — | `kind` |

Mặc định sắp xếp khi không truyền `sort`: theo trường ngày chính giảm dần nếu có, ngược lại theo `createdAt` giảm dần.

---

## 3. Model chi tiết theo module

Cột "Bắt buộc" = app không cho lưu nếu thiếu. Các trường hệ thống (mục 0.1) có ở **mọi** module nên không lặp lại.

### `portfolios` — Danh mục

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `name` | string | ✔ | Tên danh mục |  |
| `strategy` | enum |  | Chiến lược | Dòng tiền ổn định / Giá trị gia tăng / Phát triển / Thương mại |
| `region` | string |  | Khu vực | gợi ý: Ví dụ: Miami-Dade |
| `owner` | string |  | Người phụ trách |  |
| `note` | string |  | Ghi chú |  |

**Bản ghi con:** `properties.portfolio` (gỡ liên kết)

### `properties` — Tài sản

_trường trạng thái: `status` · lọc nhanh theo `type`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `name` | string | ✔ | Tên tài sản |  |
| `type` | enum | ✔ | Loại tài sản | Nhà ở nhiều căn / Nhà đơn lập / Thương mại / Hỗn hợp / Đất |
| `status` | enum | ✔ | Trạng thái | Đang sở hữu / Đang quản lý / Đang bán / Đã bán |
| `portfolio` | id |  | Danh mục | → `portfolios` |
| `city` | string | ✔ | Thành phố |  |
| `zip` | string | ✔ | Mã ZIP | gợi ý: 5 chữ số |
| `address` | string |  | Địa chỉ đầy đủ |  |
| `yearBuilt` | integer |  | Năm xây dựng |  |
| `area` | number |  | Diện tích (ft²) |  |
| `units` | integer |  | Số đơn vị |  |
| `ownership` | string |  | Hình thức sở hữu | gợi ý: Ví dụ: LLC, liên doanh |
| `purchasePrice` | number (USD) |  | Giá mua |  |
| `purchaseDate` | date |  | Ngày mua |  |
| `value` | number (USD) |  | Giá trị ước tính hiện tại |  |
| `owner` | string |  | Người phụ trách |  |
| `note` | string |  | Ghi chú |  |

**Bản ghi con:** `units.property` (xóa theo), `leases.property` (xóa theo), `workorders.property` (xóa theo), `expenses.property` (xóa theo), `budgets.property` (xóa theo), `loans.property` (xóa theo), `revenue.property` (xóa theo), `inspections.property` (xóa theo), `renovations.property` (xóa theo)

### `units` — Đơn vị cho thuê

_trường trạng thái: `status` · lọc nhanh theo `status`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `code` | string | ✔ | Mã đơn vị | gợi ý: Ví dụ: A-101 |
| `property` | id | ✔ | Tài sản | → `properties` |
| `type` | enum | ✔ | Loại | Studio / 1 phòng ngủ / 2 phòng ngủ / 3 phòng ngủ / Mặt bằng thương mại |
| `status` | enum | ✔ | Trạng thái | Đang thuê / Trống / Sắp trống / Đang sửa chữa / Ngừng cho thuê |
| `area` | number |  | Diện tích (ft²) |  |
| `beds` | integer |  | Phòng ngủ |  |
| `baths` | number |  | Phòng tắm |  |
| `rent` | number (USD) | ✔ | Tiền thuê niêm yết / tháng |  |
| `furnish` | enum |  | Nội thất | Không nội thất / Một phần / Đầy đủ |
| `vacantSince` | date |  | Bắt đầu trống từ |  |
| `note` | string |  | Ghi chú |  |

**Bản ghi con:** `leases.unit` (xóa theo), `rents.unit` (xóa theo), `workorders.unit` (gỡ liên kết)

### `leases` — Hợp đồng thuê

_trường trạng thái: `status` · trường ngày chính: `end` · lọc nhanh theo `status`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `unit` | id | ✔ | Đơn vị | → `units` |
| `kind` | enum | ✔ | Loại hợp đồng | Theo năm / Theo tháng / Thương mại |
| `status` | enum | ✔ | Trạng thái | Sắp bắt đầu / Đang hiệu lực / Sắp hết hạn / Hết hạn / Gia hạn / Chấm dứt |
| `start` | date | ✔ | Ngày bắt đầu |  |
| `end` | date | ✔ | Ngày kết thúc |  |
| `rent` | number (USD) | ✔ | Tiền thuê / tháng |  |
| `deposit` | number (USD) |  | Tiền đặt cọc |  |
| `renewal` | string |  | Điều khoản gia hạn |  |
| `prev` | id |  | Hợp đồng trước (gia hạn từ) | → `leases` |
| `note` | string |  | Ghi chú |  |

### `rents` — Thu tiền thuê

_trường trạng thái: `status` · trường ngày chính: `month` · lọc nhanh theo `status` · **khóa theo kỳ đã chốt**_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `unit` | id | ✔ | Đơn vị | → `units` |
| `month` | date | ✔ | Tháng | gợi ý: Chọn ngày bất kỳ trong tháng |
| `due` | number (USD) | ✔ | Tiền thuê đến hạn |  |
| `paid` | number (USD) |  | Số đã thu (ghi tay) |  |
| `lastPaid` | date |  | Ngày thu gần nhất |  |
| `note` | string |  | Ghi chú |  |

### `workorders` — Bảo trì

_trường trạng thái: `status` · trường ngày chính: `dueDate` · lọc nhanh theo `status`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `title` | string | ✔ | Tiêu đề |  |
| `property` | id | ✔ | Tài sản | → `properties` |
| `unit` | id |  | Đơn vị (bỏ trống = khu vực chung) | → `units` |
| `category` | enum | ✔ | Loại | Nước / Điện / Điều hòa / Thiết bị / Mái / Cảnh quan / An toàn cháy / Khác |
| `priority` | enum | ✔ | Mức độ | Khẩn cấp / Cao / Thường |
| `status` | enum | ✔ | Trạng thái | Mới / Đã giao / Đang xử lý / Chờ vật tư / Hoàn tất / Hủy |
| `description` | string |  | Mô tả |  |
| `vendor` | id |  | Nhà thầu | → `vendors` |
| `estCost` | number (USD) |  | Chi phí ước tính |  |
| `actualCost` | number (USD) |  | Chi phí thực tế |  |
| `dueDate` | date | ✔ | Hạn xử lý |  |
| `doneDate` | date |  | Ngày hoàn tất |  |
| `owner` | string |  | Người phụ trách |  |

### `vendors` — Nhà thầu

_trường trạng thái: `status` · lọc nhanh theo `service`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `company` | string | ✔ | Tên công ty |  |
| `service` | enum | ✔ | Loại dịch vụ | Điện / Nước / Mái / Xây dựng / Cảnh quan / Vệ sinh / Bảo vệ / Điều hòa |
| `status` | enum | ✔ | Trạng thái | Đang hợp tác / Tạm dừng |
| `area` | string |  | Khu vực phục vụ |  |
| `license` | string |  | Số giấy phép hành nghề |  |
| `licenseExp` | date |  | Giấy phép hết hạn |  |
| `insuranceExp` | date |  | Bảo hiểm trách nhiệm hết hạn |  |
| `phone` | string |  | Điện thoại chung công ty | chỉ liên hệ chung của công ty |
| `email` | string |  | Email chung công ty | chỉ liên hệ chung của công ty |
| `ratePrice` | integer (1–5) |  | Đánh giá giá |  |
| `rateTime` | integer (1–5) |  | Đánh giá đúng hạn |  |
| `rateQuality` | integer (1–5) |  | Đánh giá chất lượng |  |
| `note` | string |  | Ghi chú |  |

**Bản ghi con:** `workorders.vendor` (gỡ liên kết), `renovations.vendor` (gỡ liên kết)

### `inspections` — Kiểm tra tài sản

_trường trạng thái: `result` · trường ngày chính: `date` · lọc nhanh theo `result`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `property` | id | ✔ | Tài sản | → `properties` |
| `item` | enum | ✔ | Hạng mục | Mái / Kết cấu / Hệ thống điện / Cấp thoát nước / Điều hòa / An toàn cháy / Thang máy / Bãi đậu xe / Cảnh quan |
| `result` | enum | ✔ | Kết quả | Tốt / Cần theo dõi / Cần sửa gấp |
| `date` | date | ✔ | Ngày kiểm tra |  |
| `inspector` | string |  | Người kiểm | gợi ý: Tên tự do |
| `note` | string |  | Ghi chú |  |

### `renovations` — Dự án cải tạo

_trường trạng thái: `status` · trường ngày chính: `eta` · lọc nhanh theo `status`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `name` | string | ✔ | Tên dự án |  |
| `property` | id | ✔ | Tài sản | → `properties` |
| `status` | enum | ✔ | Trạng thái | Dự kiến / Xin phép / Đang thi công / Nghiệm thu / Hoàn thành / Tạm dừng |
| `scope` | string |  | Phạm vi |  |
| `budget` | number (USD) | ✔ | Ngân sách |  |
| `actual` | number (USD) |  | Chi phí thực tế |  |
| `vendor` | id |  | Nhà thầu | → `vendors` |
| `start` | date |  | Ngày bắt đầu |  |
| `eta` | date |  | Dự kiến hoàn thành |  |
| `progress` | number (0–100) |  | Hoàn thành (%) |  |
| `permitNo` | string |  | Số giấy phép xây dựng |  |
| `permitExp` | date |  | Giấy phép hết hạn |  |
| `rentLift` | number (USD) |  | Tăng tiền thuê sau cải tạo / tháng |  |
| `note` | string |  | Ghi chú |  |

**Bản ghi con:** `milestones.renovation` (xóa theo)

### `milestones` — Mốc tiến độ

_trường trạng thái: `status` · trường ngày chính: `due`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `title` | string | ✔ | Tên mốc |  |
| `renovation` | id | ✔ | Dự án | → `renovations` |
| `due` | date | ✔ | Hạn |  |
| `status` | enum | ✔ | Trạng thái | Chưa xong / Đã xong |
| `note` | string |  | Ghi chú |  |

### `tasks` — Việc cần làm

_trường trạng thái: `status` · trường ngày chính: `due` · lọc nhanh theo `status`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `title` | string | ✔ | Tiêu đề |  |
| `related` | string |  | Bản ghi liên quan | gợi ý: Tên bản ghi liên quan |
| `owner` | string |  | Người phụ trách |  |
| `due` | date | ✔ | Hạn |  |
| `priority` | enum | ✔ | Ưu tiên | Khẩn cấp / Cao / Thường |
| `status` | enum | ✔ | Trạng thái | Chưa làm / Đang làm / Xong |
| `remind` | integer |  | Nhắc trước (ngày) |  |
| `note` | string |  | Ghi chú |  |

### `expenses` — Chi phí

_trường ngày chính: `date` · lọc nhanh theo `category` · **khóa theo kỳ đã chốt**_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `property` | id | ✔ | Tài sản | → `properties` |
| `category` | enum | ✔ | Loại chi phí | Thuế BĐS / Bảo hiểm / Tiện ích / Sửa chữa & bảo trì / Quản lý / Quảng cáo / Lãi vay / Phí pháp lý / Vốn hóa cải tạo |
| `nature` | enum | ✔ | Tính chất | Vận hành / Vốn hóa |
| `amount` | number (USD) | ✔ | Số tiền |  |
| `date` | date | ✔ | Ngày |  |
| `supplier` | string |  | Nhà cung cấp (tên công ty) |  |
| `note` | string |  | Ghi chú |  |

### `budgets` — Ngân sách năm

_lọc nhanh theo `category`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `property` | id | ✔ | Tài sản | → `properties` |
| `year` | integer | ✔ | Năm |  |
| `category` | enum | ✔ | Loại chi phí | Thuế BĐS / Bảo hiểm / Tiện ích / Sửa chữa & bảo trì / Quản lý / Quảng cáo / Lãi vay / Phí pháp lý / Vốn hóa cải tạo |
| `amount` | number (USD) | ✔ | Ngân sách năm |  |
| `note` | string |  | Ghi chú |  |

### `loans` — Khoản vay

_trường trạng thái: `status` · trường ngày chính: `maturity`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `property` | id | ✔ | Tài sản | → `properties` |
| `lender` | string | ✔ | Bên cho vay (tổ chức) |  |
| `status` | enum | ✔ | Trạng thái | Đang trả / Tái tài trợ / Đã tất toán |
| `principal` | number (USD) | ✔ | Số tiền gốc ban đầu |  |
| `balance` | number (USD) | ✔ | Số dư hiện tại (ghi tay) |  |
| `rate` | number (0–100) | ✔ | Lãi suất (%/năm) |  |
| `kind` | enum |  | Loại lãi suất | Cố định / Thả nổi |
| `term` | integer |  | Kỳ hạn (tháng) |  |
| `start` | date |  | Ngày bắt đầu |  |
| `maturity` | date | ✔ | Ngày đáo hạn |  |
| `rateReset` | date |  | Ngày điều chỉnh lãi suất |  |
| `payment` | number (USD) |  | Trả hằng tháng |  |
| `refi` | string |  | Điều khoản tái tài trợ |  |
| `note` | string |  | Ghi chú |  |

### `revenue` — Bản ghi doanh thu

_trường ngày chính: `month` · lọc nhanh theo `kind` · **khóa theo kỳ đã chốt**_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `property` | id | ✔ | Tài sản | → `properties` |
| `kind` | enum | ✔ | Loại thu | Tiền thuê / Phí giữ xe / Giặt / Phí kho / Khác |
| `month` | date | ✔ | Tháng |  |
| `amount` | number (USD) | ✔ | Số tiền |  |
| `source` | enum |  | Nguồn | Nhập tay / Tự sinh từ thu tiền thuê |
| `reason` | string |  | Lý do nhập tay |  |

### `targets` — Mục tiêu doanh thu & NOI

_lọc nhanh theo `period`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `period` | enum | ✔ | Kỳ | Tháng / Quý / Năm |
| `year` | integer | ✔ | Năm |  |
| `index` | integer |  | Tháng/Quý số | gợi ý: Bỏ trống nếu là mục tiêu năm |
| `revenue` | number (USD) | ✔ | Doanh thu mục tiêu |  |
| `noi` | number (USD) | ✔ | NOI mục tiêu |  |
| `note` | string |  | Ghi chú |  |

### `deals` — Giao dịch đầu tư

_trường trạng thái: `stage` · lọc nhanh theo `stage`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `name` | string | ✔ | Tên cơ hội |  |
| `side` | enum | ✔ | Chiều giao dịch | Mua / Bán |
| `stage` | enum | ✔ | Giai đoạn | Sàng lọc / Phân tích / Chào mua / Thẩm định / Đóng giao dịch / Từ chối |
| `area` | string |  | Khu vực |  |
| `type` | enum |  | Loại tài sản | Nhà ở nhiều căn / Nhà đơn lập / Thương mại / Hỗn hợp / Đất |
| `ask` | number (USD) |  | Giá chào |  |
| `offer` | number (USD) |  | Giá đề nghị |  |
| `noi` | number (USD) |  | NOI dự kiến / năm |  |
| `source` | string |  | Nguồn |  |
| `owner` | string |  | Người phụ trách |  |
| `property` | id |  | Tài sản (với cơ hội bán) | → `properties` |
| `note` | string |  | Ghi chú |  |

**Bản ghi con:** `checklist.deal` (xóa theo), `scenarios.deal` (gỡ liên kết)

### `checklist` — Checklist thẩm định

_trường trạng thái: `status` · lọc nhanh theo `status`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `deal` | id | ✔ | Cơ hội đầu tư | → `deals` |
| `item` | enum | ✔ | Hạng mục | Pháp lý & quyền sở hữu / Kiểm tra tòa nhà / Môi trường / Bảo hiểm / Hợp đồng thuê hiện hữu / Thuế / Tài chính |
| `status` | enum | ✔ | Trạng thái | Chưa kiểm / Đạt / Có vấn đề |
| `note` | string |  | Ghi chú |  |

### `sales` — Giao dịch đã chốt

_trường ngày chính: `date` · lọc nhanh theo `kind`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `property` | id | ✔ | Tài sản | → `properties` |
| `kind` | enum | ✔ | Loại giao dịch | Bán tài sản / Cho thuê đơn vị / Gia hạn hợp đồng / Mua vào |
| `date` | date | ✔ | Ngày chốt |  |
| `product` | enum | ✔ | Loại sản phẩm | Studio / 1 phòng ngủ / 2 phòng ngủ / 3 phòng ngủ / Mặt bằng thương mại / Nhà đơn lập / Đất / Cả tài sản |
| `qty` | integer | ✔ | Số lượng (căn / đơn vị) |  |
| `value` | number (USD) | ✔ | Giá trị giao dịch |  |
| `note` | string |  | Ghi chú |  |

### `scenarios` — Kịch bản phân tích

_lọc nhanh theo `tool`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `name` | string | ✔ | Tên kịch bản |  |
| `tool` | string | ✔ | Công cụ |  |
| `deal` | id |  | Gắn với cơ hội | → `deals` |
| `inputs` | string |  | Giả định |  |
| `result` | string |  | Kết quả |  |

### `partners` — Đối tác

_lọc nhanh theo `kind`_

| Trường | Kiểu | Bắt buộc | Nhãn trong app | Ràng buộc / ghi chú |
|---|---|:-:|---|---|
| `company` | string | ✔ | Tên công ty |  |
| `kind` | enum | ✔ | Loại | Ngân hàng & bên cho vay / Môi giới / Đơn vị quản lý / Công ty bảo hiểm / Công ty thuế / Luật sư / Bảo hiểm quyền sở hữu / Nhà thầu |
| `city` | string |  | Thành phố |  |
| `website` | string (URL) |  | Website |  |
| `phone` | string |  | Điện thoại chung | chỉ liên hệ chung của công ty |
| `email` | string |  | Email chung | chỉ liên hệ chung của công ty |
| `note` | string |  | Ghi chú |  |


### 3.1 Ghi chú bổ sung cho từng module (trường ngoài biểu mẫu & điều kiện)

| Module | Ghi chú |
|---|---|
| `properties` | `address` chỉ hiện/nhập khi `type` = `Thương mại` hoặc `Đất`. `units` (số đơn vị khai báo) chỉ dùng khi tài sản chưa có bản ghi `units`; khi đã có thì app đếm theo bản ghi. |
| `leases` | Có thêm trường **server tính** `property` (= `units.property` của `unit`). |
| `rents` | Có thêm trường **server tính** `property` và `status` (quy tắc mục 4). `paid` mặc định `0`. |
| `workorders` | `unit` = `null` nghĩa là "khu vực chung". `dueDate` mặc định phía app = hôm nay + 7 ngày. |
| `tasks` | `related` là **tên tự do**, không phải khóa ngoại. `remind` mặc định 1. |
| `deals` | Có thêm trường **server tính** `cap` (cap rate %, 2 chữ số, `null` nếu không có giá). `property` chỉ dùng cho cơ hội `Bán`. |
| `revenue` | `source` mặc định `Nhập tay` nếu client không gửi. `Tự sinh từ thu tiền thuê` chỉ do server gán. |
| `sales` | Dữ liệu nguồn của bảng xếp hạng "Bán chạy nhất" (mục 6.5). `qty` mặc định 1. **Không có nhân viên** — xếp hạng theo tài sản / loại sản phẩm. |
| `scenarios` | Ngoài các trường biểu mẫu, bản ghi lưu từ Toolkit có thêm `calc` (tên công cụ, trùng `tool`) và `values` (**chuỗi JSON** chứa giả định để mở lại trong máy tính — xem mục 7). BE lưu nguyên chuỗi, không parse. |
| `vendors` | `ratePrice`, `rateTime`, `rateQuality` là điểm 1–5; điểm trung bình hiển thị = trung bình 3 trường. |
| `partners` | `kind` gồm: Ngân hàng & bên cho vay / Môi giới / Đơn vị quản lý / Công ty bảo hiểm / Công ty thuế / Luật sư / Bảo hiểm quyền sở hữu / Nhà thầu. |

---

## 4. Logic bắt buộc ở server (hiện đang chạy trong app qua `onSave`)

Khi `POST`/`PATCH`, **server phải chuẩn hóa lại** rồi mới lưu, vì sau khi bỏ dữ liệu mẫu nhiều màn hình phụ thuộc vào các giá trị này.

| Module | Quy tắc |
|---|---|
| `leases` | `property` ← `units[unit].property`. |
| `rents` | `property` ← `units[unit].property`. `month` ← ngày đầu tháng. **`status`** (xem bên dưới). |
| `workorders` | Nếu `status = "Hoàn tất"` và `doneDate` rỗng → `doneDate` = hôm nay. |
| `expenses` | Nếu `category = "Vốn hóa cải tạo"` → ép `nature = "Vốn hóa"`. |
| `revenue` | `month` ← ngày đầu tháng. `source` ← `Nhập tay` nếu rỗng. |
| `deals` | `cap` = `noi / (offer > 0 ? offer : ask) × 100`, làm tròn 2 số; `null` nếu giá = 0. |

**Trạng thái `rents.status`** (với `due` = tiền đến hạn, `paid` = đã thu, `m` = tháng của kỳ thu, `hôm nay` theo giờ Florida):

1. `paid >= due` và `due > 0` → `Đã thu đủ`
2. Ngược lại, nếu hôm nay **sau ngày 5 của tháng `m`**:
   - `paid > 0` → `Thu một phần`; nhưng nếu hôm nay đã **sau ngày 5 của tháng kế tiếp** → `Quá hạn`
   - `paid = 0` → `Quá hạn`
3. Ngược lại: `paid > 0` → `Thu một phần`, còn lại → `Chưa thu`

Vì phụ thuộc thời gian, **server tính lại khi đọc** (hoặc chạy job hằng ngày) — app đang tự tính lại mỗi lần mở.

### 4.1 Tạo kỳ thu tiền thuê tháng này

`POST /v1/rents:generateThisMonth` → với mỗi hợp đồng có `status ∈ {Đang hiệu lực, Sắp hết hạn}` chưa có kỳ thu của tháng hiện tại cho cùng `unit`, tạo `rents { unit, month: <đầu tháng>, due: lease.rent, paid: 0 }`. Trả `{ "created": 5 }`.

### 4.2 Gia hạn / chấm dứt hợp đồng

Không cần endpoint riêng, nhưng thứ tự thao tác của app như sau (BE nên cho phép chạy **trong 1 transaction** nếu muốn: `POST /v1/leases/{id}:renew`):

- **Gia hạn:** tạo hợp đồng mới `{ unit, kind, status: "Sắp bắt đầu", start: end_cũ + 1 ngày, end: end_cũ + 1 năm, rent, deposit, renewal, prev: id_cũ }`, rồi đặt hợp đồng cũ `status = "Gia hạn"`.
- **Chấm dứt:** chỉ `PATCH status = "Chấm dứt"` (không xóa; có thể hoàn tác qua lịch sử).

### 4.3 Khóa kỳ đã chốt (`periodLocked`)

Áp dụng cho `rents`, `expenses`, `revenue`. Bản ghi có **trường ngày chính** (`month` / `date`) **nhỏ hơn ngày đầu của tháng cách đây 3 tháng** (`closedBefore = (năm, tháng hiện tại − 3, ngày 1)`) thì:

- `PATCH`, `DELETE`, bulkDelete → `423 Locked`, `code = "PERIOD_LOCKED"`, message: "Kỳ này đã chốt, không thể sửa hoặc xóa."
- `closedBefore` do server quyết định; app đang tự tính cứng 3 tháng. Khuyến nghị server trả giá trị trong `GET /v1/config` (mục 8.2) để app không phải đoán.
- ❓ App hiện chỉ chặn sửa/xóa. Có chặn **tạo mới** vào kỳ đã chốt không → BE/PO quyết định (khuyến nghị: chặn).

### 4.4 Kiểm soát xung đột (`version`)

- `PATCH` bắt buộc kèm `If-Match: <version đang xem>`. Nếu `version` hiện tại khác → `409 Conflict`, `code = "VERSION_CONFLICT"`, body kèm bản ghi hiện tại để app hiện "Bản ghi đã được người khác sửa".
- Chỉ tăng `version` và `updatedAt` khi **thực sự có trường thay đổi** (so sánh giá trị sau chuẩn hóa).

### 4.5 Giới hạn xóa (chống xóa nhầm hàng loạt)

| Giới hạn | Giá trị | Lỗi |
|---|---|---|
| Tổng số bản ghi xóa trong cửa sổ trượt | **60 bản ghi / 10 phút / người dùng-thiết bị** (app chỉ đếm bản ghi gốc, không đếm bản ghi bị xóa theo cascade) | `429`, `code = "DELETE_RATE_LIMIT"`, "Bạn đã xóa quá nhiều bản ghi trong 10 phút. Vui lòng thử lại sau." |
| Xóa hàng loạt | **≤ 30 id / request** | `422`, `code = "BULK_LIMIT"`, "Mỗi lần chỉ xóa hàng loạt tối đa 30 bản ghi." |

Xóa **không có thùng rác**: app đã cảnh báo "Không có Thùng rác" và bắt người dùng gõ `XOA` để xác nhận (xác nhận ở client, server không cần).

### 4.6 Xuất CSV

App xuất CSV phía client từ dữ liệu đã tải (không có cột `id`). Giới hạn **20 lượt xuất/ngày/người dùng** hiện tính cục bộ; nếu muốn kiểm soát thật: `POST /v1/exports:consume` → `200 { "left": 19 }` hoặc `429`.

### 4.7 Nhập CSV

App parse file trên máy rồi gửi từng dòng đã hợp lệ. Chỉ áp dụng cho `properties` và `units`; tối đa **200 dòng / 300 KB**; từ chối cột nhạy cảm (số thẻ, SSN, điện thoại, email cá nhân). Đề nghị endpoint `POST /v1/{module}:bulkCreate` nhận `{ "items": [...] }` (≤ 200), trả kết quả theo từng dòng `{ "index": 3, "error": {...} }` để app hiện lỗi từng dòng; **cùng quy tắc Guard (mục 0.3)**.

---

## 5. Lịch sử chỉnh sửa (`history`)

Mỗi create/update/delete/restore ghi 1 dòng. Màn hình "Lịch sử chỉnh sửa" và tab lịch sử trong chi tiết bản ghi đọc từ đây; từ lịch sử có thể **hoàn tác** một lần sửa.

**HistoryEntry**

| Trường | Kiểu | Mô tả |
|---|---|---|
| `id` | string | |
| `module` | string | Khóa module (`properties`…) |
| `recId` | string | Id bản ghi |
| `label` | string | Tên hiển thị của bản ghi tại thời điểm ghi (với `delete` app dùng tên loại bản ghi, ví dụ "tài sản") |
| `by` | string | Tên người thực hiện (`Ẩn danh` nếu không có tên) |
| `at` | datetime | |
| `action` | enum | `create` \| `update` \| `delete` \| `restore` |
| `changes` | object | Chỉ có khi `update`/`restore`: `{ "<field>": [giáTrịCũ, giáTrịMới] }`. Không ghi `updatedAt`, `version` |

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/v1/history?limit=&cursor=&module=&recId=&action=&by=` | Toàn bộ lịch sử, mới nhất trước. App hiện giữ tối đa 800 dòng gần nhất |
| `GET` | `/v1/{module}/{id}/history` | Lịch sử một bản ghi |
| `POST` | `/v1/history/{id}:revert` | Hoàn tác một `update`: áp lại giá trị **cũ** của các trường trong `changes` bằng 1 phép update mới (tăng `version`, ghi thêm dòng lịch sử `action = "restore"`). `409` nếu bản ghi đã bị xóa |

Quy tắc khi xóa: xóa bản ghi → xóa mọi dòng lịch sử của bản ghi đó **và của các bản ghi bị cascade**, sau đó thêm đúng 1 dòng `delete` cho bản ghi gốc.

**Cảnh báo "thay đổi bất thường":** server (hoặc app) đánh dấu bản ghi có **≥ 5 lần `update` trong 60 phút**. Nên có `GET /v1/history/unusual` → danh sách bản ghi + số lần sửa.

### 5.1 Báo cáo nội dung (ContentReport) — tùy chọn

Model còn trong code nhưng **UI báo cáo đã bị gỡ khỏi chi tiết bản ghi**, chỉ còn màn hình "Báo cáo nội dung" trong menu. Nếu giữ:

| Trường | Kiểu | |
|---|---|---|
| `id`, `module`, `recId`, `label`, `reason`, `detail`, `at` | | |
| `status` | enum | `Chờ kiểm duyệt` \| `Đã xử lý` |

`GET /v1/reports`, `POST /v1/reports`, `PATCH /v1/reports/{id}`. Nếu BE không làm, báo lại để app gỡ màn hình này.

---

## 6. Số liệu tổng hợp (dashboard, báo cáo, xếp hạng)

Hiện toàn bộ số liệu **được app tự tính** từ các list. Có 2 cách triển khai:

- **Giai đoạn 1 (tối thiểu, app chạy được ngay):** BE chỉ cần CRUD + `all=true`. App tính như mô tả dưới.
- **Giai đoạn 2 (khuyến nghị khi dữ liệu lớn):** BE cung cấp các endpoint tổng hợp dưới đây. Công thức **phải giống nhau** để số trên app không đổi.

Tham số chung: `period` ∈ `month|quarter|year`, `propertyId`, `portfolioId` (tùy chọn, lọc theo tài sản/danh mục), `at` (ngày tham chiếu, mặc định hôm nay).

### 6.1 Định nghĩa

| Chỉ số | Công thức |
|---|---|
| Kỳ hiện tại | `month`: tháng lịch · `quarter`: quý lịch · `year`: năm lịch. Kỳ trước = kỳ cùng loại liền trước |
| Đơn vị tính lấp đầy | `units` có `status ≠ "Ngừng cho thuê"` |
| Đang có người thuê | `status ∈ {Đang thuê, Sắp trống}` |
| **Occupancy %** | `đangThuê / tổngĐơnVịTínhLấpĐầy × 100` |
| Tiền thuê niêm yết | Σ `units.rent` (đơn vị tính lấp đầy) |
| Tiền thuê thực tế | Σ `leases.rent` với `status ∈ {Đang hiệu lực, Sắp hết hạn}` |
| **Doanh thu** (kỳ) | Σ `revenue.amount` có `month` trong kỳ |
| Doanh thu tiền thuê | như trên nhưng `kind = "Tiền thuê"` |
| Thu khác | Doanh thu − Doanh thu tiền thuê |
| **Opex** (kỳ) | Σ `expenses.amount` có `date` trong kỳ, `nature = "Vận hành"`, **`category` ∉ {`Lãi vay`, `Vốn hóa cải tạo`}** |
| **Capex** (kỳ) | Σ `expenses.amount` trong kỳ với `nature = "Vốn hóa"` hoặc `category = "Vốn hóa cải tạo"` |
| **NOI** | Doanh thu − Opex |
| Ngân sách (kỳ) | Σ `budgets.amount / 12` cho mỗi tháng trong kỳ khớp `budgets.year`, bỏ category `Lãi vay` & `Vốn hóa cải tạo` |
| Nợ vay hằng năm (debt service) | Σ `loans.payment × 12` với `status ≠ "Đã tất toán"` (theo tài sản nếu lọc) |
| Tổng dư nợ | Σ `loans.balance` với `status ≠ "Đã tất toán"` |
| **DSCR** (theo tài sản) | `NOI / debtService` (`null` nếu debtService = 0) |
| Dòng tiền sau nợ | `NOI − debtService` |
| NOI / giá mua | `NOI / purchasePrice × 100` |
| Tỷ lệ thu tiền (kỳ) | Σ `min(paid, due)` / Σ `due` của các kỳ thu có `month` trong kỳ (× 100); `0` nếu Σ `due` = 0 |
| Quá hạn | Các `rents` `status = "Quá hạn"`: tổng `due − paid` và số đơn vị |
| Bảo trì đang mở | `workorders.status ∈ {Mới, Đã giao, Đang xử lý, Chờ vật tư}`; quá hạn = `dueDate` < hôm nay |
| Thời gian xử lý TB (ngày) | TB `max(0, doneDate − createdAt)` (số ngày nguyên) của lệnh `Hoàn tất` có `doneDate`; `0` nếu chưa có |
| HĐ sắp hết hạn trong N ngày | `leases` đang hiệu lực có `end` trong N ngày tới |
| Khoản vay đáo hạn trong N ngày | `loans` chưa tất toán có `maturity` ≤ hôm nay + N |
| Cơ hội đang mở | `deals.stage ∉ {Đóng giao dịch, Từ chối}` |
| Việc đang mở / quá hạn / sắp hạn | `tasks.status ≠ "Xong"`; quá hạn: `due` < hôm nay; sắp hạn: 0–3 ngày |

### 6.2 Endpoint đề xuất

| Endpoint | Trả về |
|---|---|
| `GET /v1/analytics/summary` | `{ propertyCount, unitCount, occupancy, listedRent, actualRent, revenue, noi, opex, capex, budget, totalDebt, collectionRate, overdue:{amount,units}, openWorkOrders, overdueWorkOrders, avgResolveDays, openDeals, tasksOpen, tasksOverdue, tasksDueSoon }` cho kỳ hiện tại **và** `previous` (để hiện % tăng giảm) |
| `GET /v1/analytics/monthly?n=12` | `[{ month, revenue, opex, noi }]` n tháng gần nhất |
| `GET /v1/analytics/occupancy-trend?n=12` | `[{ month, occupancy }]` |
| `GET /v1/analytics/performance?period=` | Theo tài sản: `{ propertyId, occupancy, revenue, opex, noi, debt, cashFlow, area, noiOnCost, dscr }` |
| `GET /v1/analytics/expense-by-category?period=` | `{ "<category>": amount }` giảm dần |
| `GET /v1/analytics/budget-vs-actual?year=` | `[{ category, budget, actual }]` |
| `GET /v1/analytics/aging` | `{ "Chưa đến hạn": x, "1–30 ngày": x, "31–60 ngày": x, "> 60 ngày": x }` — mỗi kỳ thu còn thiếu (`due − paid > 0`) xếp theo số ngày trễ = hôm nay − **ngày 5 của tháng `month`** (≤0 → Chưa đến hạn; ≤30; ≤60; còn lại) |
| `GET /v1/analytics/pipeline` | Số cơ hội & tổng giá theo `deals.stage`, tách `Mua`/`Bán` |

### 6.3 Cảnh báo (`alerts`)

`GET /v1/alerts` → `[{ key, title, subtitle, severity, module }]`. Các `key` (người dùng tắt/bật từng loại trong Cài đặt):

| `key` | Điều kiện | Tiêu đề (mẫu) |
|---|---|---|
| `lease` | Có HĐ đang hiệu lực hết hạn ≤ 60 ngày | "N hợp đồng thuê sắp hết hạn" |
| `vacant` | `units.status = "Trống"` và `vacantSince` > 30 ngày | "N đơn vị trống quá 30 ngày" |
| `rent` | Có `rents` quá hạn | "Tiền thuê quá hạn $X" |
| `wo` | Có lệnh khẩn cấp đang mở hoặc quá hạn | "N lệnh khẩn cấp · M lệnh quá hạn" |
| `loan` | Có khoản vay đáo hạn trong 365 ngày | "N khoản vay đáo hạn trong 12 tháng" |
| `budget` | Opex lũy kế năm > ngân sách lũy kế × 1,1 | "Chi phí vượt ngân sách X%" |
| `budget_m` | Opex tháng này > ngân sách tháng × 1,1 | |
| `unusual` | ≥ 5 lần sửa trên 1 bản ghi trong 60 phút | |

### 6.4 Hàng đợi việc (`queue`) và timeline

Hai màn hình tự gom việc từ nhiều module. Giai đoạn 1 do app gom; giai đoạn 2 BE có thể cung cấp `GET /v1/queue` và `GET /v1/timeline?from=&to=&propertyId=`.

**Queue** (mỗi item: `module`, `recordId`, `due`, `title`, `subtitle`, `reason`, `weight`, `quick?`, `postponeField?`). Nguồn:

| Nguồn | Điều kiện đưa vào | Trọng số |
|---|---|---|
| `tasks` | chưa `Xong`, hạn ≤ 14 ngày tới | Khẩn cấp 3 / Cao 2 / Thường 1. Thao tác nhanh: `status = Xong`. Hoãn: `due` |
| `workorders` | đang mở, hạn ≤ 7 ngày **hoặc** mức `Khẩn cấp` | Khẩn cấp 4 / Cao 2 / Thường 1. Nhanh: `Hoàn tất`. Hoãn: `dueDate` |
| `leases` | đang hiệu lực, `end` ≤ 60 ngày | 2 |
| `rents` | `status = Quá hạn` (due = ngày 5 của tháng `month`) | 3 |
| `loans` | chưa tất toán; `maturity` hoặc `rateReset` trong ≤ 90 ngày (mỗi ngày 1 item) | 2 |
| `vendors` | `Đang hợp tác`; `licenseExp` hoặc `insuranceExp` trong ≤ 45 ngày | 1 |
| `milestones` | chưa `Đã xong`, hạn ≤ 14 ngày. Nhanh: `Đã xong`. Hoãn: `due` | 1 |
| `checklist` | `status = Có vấn đề` (due = hôm nay) | 2 |

Postpone (hoãn 1 / 7 ngày) chỉ là `PATCH` trường hạn; không cần bảng riêng.

**Timeline** (sự kiện theo ngày): HĐ hết hạn (`leases.end`, chỉ đang hiệu lực), đáo hạn vay (`loans.maturity`), điều chỉnh lãi suất (`loans.rateReset`), hạn bảo trì (`workorders.dueDate`, đang mở), hoàn thành dự án (`renovations.eta`, chưa hoàn thành), giấy phép / bảo hiểm nhà thầu hết hạn (`vendors.licenseExp`, `insuranceExp`), mốc tiến độ (`milestones.due`, chưa xong), việc cần làm (`tasks.due`, chưa xong).

### 6.5 Xếp hạng bán chạy nhất (thay cho "nhân viên xuất sắc")

`GET /v1/analytics/best-selling?period=month|quarter|year&groupBy=property|product`

- Cửa sổ **trượt**: `month` = 30 ngày, `quarter` = 90 ngày, `year` = 365 ngày, tính đến hết hôm nay.
- Lấy `sales` có `date` trong cửa sổ, nhóm theo `property` (hoặc `product`).
- Mỗi nhóm: `qty = Σ qty`, `value = Σ value`, `deals = số bản ghi`, `byKind = { "<kind>": Σ qty }`.
- **Sắp xếp:** `qty` giảm dần, bằng nhau thì `value` giảm dần.
- Trả mỗi dòng: `{ key, title, subtitle, propertyId?, qty, value, deals, byKind }`. (Với `groupBy=property`, `title` = tên tài sản, `subtitle` = `type · city`; với `product`, `title` = giá trị `product`, `subtitle` = "Loại sản phẩm".)

---

## 7. Toolkit & Kịch bản

- 9 máy tính (phân tích mua, độ nhạy, trả nợ…) **tính hoàn toàn trên app** — không cần API.
- Chỉ **kịch bản đã lưu** đi qua API là module `scenarios` (CRUD chuẩn mục 2). Trường đặc biệt:
  - `tool` / `calc`: tên máy tính, ví dụ `Phân tích mua tài sản cho thuê`, `Phân tích độ nhạy`.
  - `values`: **chuỗi JSON** giả định, ví dụ `{"price":1210000,"reno":40000,"rent":9600,"vac":5,"opex":8000,"tax":12000,"ins":5320,"ltv":70,"rate":6.5,"years":30}`.
  - `inputs`, `result`: văn bản mô tả giả định và kết quả (nhiều dòng; dòng đầu của `result` hiện làm phụ đề trên thẻ).
  - `deal`: id cơ hội gắn kèm (tùy chọn).
- "Hướng dẫn & mẫu biểu" trong Toolkit là nội dung tĩnh, EAL cập nhật ngoài app: hiện **nằm trong code** (`toolkit.dart: _guides`). Nếu muốn cập nhật không cần phát hành app mới → `GET /v1/content/guides` trả `[{ title, icon, body }]`.

---

## 8. Cấu hình, thông tin công ty, định danh

### 8.1 Thông tin công ty & nội dung pháp lý (hiện hard-code → nên lấy từ API, vì "không có fake data")

`GET /v1/company`

| Trường | Ví dụ (đang dùng trong app) |
|---|---|
| `name` | `EAL INVESTMENT INC.` |
| `field`, `fieldVi` | `Real Estate Investment & Management` / `Đầu tư và Quản lý Bất động sản` |
| `address` | `13499 Biscayne Blvd Ste M4, North Miami, FL 33181-2036, United States` |
| `phone` | `+1 804 960 6738` |
| `email` | `endorahma@gmail.com` |
| `website` | `https://ealinvesterment.blogspot.com/p/home.html/` |
| `hours` | `Thứ 2 – Thứ 6 · 9:00 – 17:30 (EST)` |
| `founded` | `2015` |
| `serviceArea` | `Miami-Dade, Broward · Florida` |
| `assetTypes` | `Nhà ở nhiều căn, nhà đơn lập, thương mại, đất` |
| `published` | `{ period: "Q3/2026", updatedAt: "2026-10-05", properties: 24, units: 412, occupancy: 94.6 }` — **số liệu EAL công bố**, độc lập với dữ liệu dùng chung |

`GET /v1/legal/terms` và `GET /v1/legal/privacy` → `{ intro, sections: [{ title, body }], updatedAt }` (app đang hard-code từ tài liệu mô tả mục 7–8).

### 8.2 Cấu hình

`GET /v1/config` → `{ "closedBefore": "2026-08-01", "deleteLimit": { "perWindow": 60, "windowMinutes": 10, "bulkMax": 30 }, "exportPerDay": 20, "importMaxRows": 200, "importMaxKb": 300, "minAppVersion": "1.0.0" }`

### 8.3 Định danh người dùng — ❓ cần BE & PO quyết

App **không có đăng nhập**. Hiện chỉ có "Tên hiển thị" tùy chọn (ghi vào `createdBy` / `history.by`; để trống → `Ẩn danh`). Cần chọn một:

1. **Không tài khoản (như hiện tại):** app gửi `X-Device-Id` (UUID sinh 1 lần/cài đặt) + `X-Display-Name`. Rate limit và lịch sử theo thiết bị. Đơn giản nhưng ai có API key đều ghi được.
2. **Đăng nhập (khuyến nghị cho dữ liệu dùng chung thật):** `POST /v1/auth/login` → access/refresh token; `createdBy`/`by` lấy từ hồ sơ. App cần thêm màn hình đăng nhập.

Dù chọn gì, `Authorization` và HTTPS là bắt buộc; không để API mở công khai.

### 8.4 Thiết lập **chỉ lưu trên thiết bị** (không cần API)

Giao diện sáng/tối, đơn vị diện tích (ft²/m²), tên hiển thị, đã xem onboarding, bộ lọc báo cáo yêu thích, danh sách cảnh báo đã tắt (`mutedAlerts`). Nếu muốn đồng bộ đa thiết bị sau này: `GET/PUT /v1/me/preferences`.

---

## 9. Việc phía app khi nối API (để BE biết app sẽ đổi gì)

1. Xóa `lib/data/seed.dart` và `LocalMockApi`; thay bằng `HttpApiClient` implement các endpoint trên.
2. Lần đầu mở app: gọi tuần tự `config`, `company`, rồi các list (`all=true`). **Không có dữ liệu mẫu** → mọi màn hình phải có trạng thái rỗng (empty state) hợp lý.
3. Mọi thao tác ghi gọi API trước, thành công mới cập nhật giao diện (hoặc cập nhật lạc quan + hoàn tác nếu lỗi). Hiển thị `message` của lỗi `422/409/423/429` nguyên văn.
4. Bỏ nút "Đặt lại dữ liệu mẫu" trong Cài đặt (nếu có).
5. Offline: giai đoạn đầu chỉ đọc cache lần tải gần nhất, báo "Không có mạng" khi ghi.

## 10. Câu hỏi cần BE/PO chốt

1. Cách định danh người dùng (mục 8.3) và có phân quyền (xem / sửa / xóa) không.
2. `sales.property` có cascade khi xóa tài sản không (mục 1).
3. Có chặn **tạo mới** vào kỳ đã chốt không (mục 4.3); ai được phép "chốt kỳ" và có endpoint để chốt không (hiện cứng 3 tháng).
4. Giai đoạn 1 hay 2 cho analytics (mục 6) — ảnh hưởng đến hiệu năng khi dữ liệu lớn.
5. Giữ hay bỏ `ContentReport` (mục 5.1) và trường `ref` mã tham chiếu.
6. Múi giờ nghiệp vụ: đề xuất `America/New_York` cho mọi phép tính "hôm nay", "ngày 5", "đầu tháng".
