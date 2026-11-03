# EAL Investment Desk API — tài liệu tích hợp cho app

**Ngôn ngữ:** toàn bộ dữ liệu, giá trị enum, nhãn, thông báo lỗi, cảnh báo, thông tin công ty đều là **tiếng Anh** (khác spec gốc dùng enum tiếng Việt — xem bảng đối chiếu ở mục 6).

Bám theo [API Spec - EAL Investment Desk (cho Backend).md](API%20Spec%20-%20EAL%20Investment%20Desk%20(cho%20Backend).md). Tài liệu này chỉ ghi **cách BE đã làm** và **những điểm BE đã chốt** cho các câu hỏi mở của spec.

## 1. Header

| Header | Bắt buộc | Ý nghĩa |
|---|:-:|---|
| `Authorization: Bearer <API_KEY>` (hoặc `X-Api-Key`) | khi server đặt `API_KEY` | Khóa truy cập API |
| `X-Display-Name` | không | Tên hiển thị người dùng tự nhập trong Cài đặt (không phải định danh) → `createdBy`, `history.by`. Có dấu tiếng Việt thì gửi `encodeURIComponent(name)`. Trống → `Anonymous` |
| `If-Match: "<version>"` | với `PATCH` | Thiếu → `428 PRECONDITION_REQUIRED`; lệch → `409 VERSION_CONFLICT` (body có `current`) |
| `Idempotency-Key` | không (nên dùng cho `POST`) | Gửi lại cùng key (cùng IP, cùng URL) → trả lại đúng phản hồi lần đầu, header `Idempotent-Replay: true` |

Mọi phản hồi bản ghi đơn có header `ETag: "<version>"`.

## 2. CRUD chung — 21 module

`{module}` ∈ `portfolios, properties, units, leases, rents, workorders, vendors, inspections, renovations, milestones, tasks, expenses, budgets, loans, revenue, targets, deals, checklist, sales, scenarios, partners`

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/v1/{module}` | `{ items, nextCursor, total }` |
| POST | `/v1/{module}` | `201` + bản ghi |
| GET | `/v1/{module}/{id}` | hỗ trợ `?expand=` |
| PATCH | `/v1/{module}/{id}` | chỉ trường có trong body thay đổi; không đổi gì thật → `version` giữ nguyên |
| DELETE | `/v1/{module}/{id}` | `204`, có cascade |
| GET | `/v1/{module}/{id}/impact` | `{ removed:[{module,id,label}], unlinked:[{module,id,label,field}], counts }` — `removed` **không** gồm bản ghi gốc |
| POST | `/v1/{module}/{id}/duplicate` | `201`, thêm ` (copy)` |
| GET | `/v1/{module}/{id}/history` | `{ items, nextCursor:null, total }` |
| POST | `/v1/{module}:bulkDelete` | `{ ids }` (không giới hạn số id) → `{ deleted, cascaded, unlinked, missing }`. Chạy trong 1 transaction: 1 id bị khóa kỳ → cả lệnh `423` |
| POST | `/v1/properties:bulkCreate`, `/v1/units:bulkCreate` | `{ items }` (không giới hạn số dòng) → `{ created, failed, results:[{index,id,record} \| {index,error:{code,message,fields}}] }`. Dòng nào lỗi thì chỉ dòng đó lỗi. `201` nếu ≥ 1 dòng tạo được, ngược lại `422` |

Trường hệ thống (`id, createdBy, createdAt, updatedAt, version`) và trường server tính (`leases.property`, `rents.property/status/gap`, `deals.cap`, `revenue.source`) client gửi lên sẽ bị **bỏ qua**.

### Query list

| Tham số | Ví dụ |
|---|---|
| `q` | tìm theo trường nhãn chính; `leases`/`rents` tìm thêm theo mã đơn vị |
| `{field}=a,b` | `status=Occupied,Notice Given&property=<id>`; `unit=null` = không có giá trị. Lọc được mọi trường, kể cả trường số (`year=2026`) |
| `{date}From`, `{date}To` | `monthFrom=2026-01-01&monthTo=2026-12-31` (mọi trường ngày) |
| `sort` | `-rent`, nhiều khóa: `-month,gap` |
| `limit` (mặc định 50, không có trần), `cursor` | |
| `all=true` | trả toàn bộ, không giới hạn |
| `expand=property,unit,vendor` | thêm `propertyName`, `unitName` + `unitCode`, `vendorName`... |

## 3. Endpoint nghiệp vụ

| Method | Path | Kết quả |
|---|---|---|
| POST | `/v1/rents:generateThisMonth` | `{ created, month }` — chạy lại không tạo trùng |
| POST | `/v1/leases/{id}:renew` | `201 { lease, previous }` trong 1 transaction. Body tùy chọn ghi đè `rent, start, end, kind, deposit, renewal, note`. HĐ đã `Renewed`/`Terminated` → `409 INVALID_STATE` |
| GET | `/v1/history?module=&recId=&action=&by=&limit=&cursor=` | mới nhất trước |
| GET | `/v1/history/unusual` | `[{ module, recId, label, count, lastAt, by }]` (≥ 5 lần sửa / 60 phút) |
| POST | `/v1/history/{id}:revert` | hoàn tác 1 dòng `update`/`restore` → bản ghi mới (`version` +1, thêm dòng `restore`). Bản ghi đã xóa → `409 RECORD_DELETED`. `If-Match` tùy chọn |
| POST | `/v1/exports:consume` | luôn `200 { left: null, limit: null }` (không giới hạn; giữ để app cũ không lỗi) |
| GET/POST/PATCH | `/v1/reports`, `/v1/reports/{id}` | Báo cáo nội dung: POST `{ module, recId, reason, detail }`, PATCH `{ status }` |
| GET | `/v1/config` | `{ closedBefore, timezone, deleteLimit, exportPerDay, importMaxRows, importMaxKb, minAppVersion }` — các giới hạn đều `null` = không giới hạn |
| GET | `/v1/company`, `/v1/legal/terms`, `/v1/legal/privacy`, `/v1/content/guides` | Nội dung tĩnh. Điều khoản/riêng tư/hướng dẫn **trả rỗng** cho tới khi EAL nhập qua `PUT /v1/content/{company\|terms\|privacy\|guides}` (header `X-Admin-Key`) |
| GET | `/v1/alerts?muted=rent,lease` | `[{ key, title, subtitle, severity: danger\|warning\|info, module, ... }]` |
| GET | `/v1/queue` | sắp xếp `weight` giảm dần rồi `due` tăng dần; item có `quick: { field, value }`, `postponeField` |
| GET | `/v1/timeline?from=&to=&propertyId=` | `{ from, to, items:[{ date, module, recordId, kind, title, subtitle, propertyId }] }`, mặc định 90 ngày tới |

### Analytics (giai đoạn 2) — tham số chung `period=month|quarter|year`, `propertyId`, `portfolioId`, `at`

`/v1/analytics/summary` · `/monthly?n=12` · `/occupancy-trend?n=12` · `/performance` · `/expense-by-category` · `/budget-vs-actual?year=` · `/aging` · `/pipeline` · `/best-selling?groupBy=property|product`

Công thức đúng mục 6.1 của spec. `summary.previous` chứa các chỉ số theo kỳ (`revenue, rentRevenue, otherRevenue, opex, capex, noi, budget, collectionRate`) của kỳ trước.

## 4. Mã lỗi

Body luôn là `{ code, message, fields? }`, `message` **tiếng Anh** — app hiện nguyên văn.

| HTTP | code |
|---|---|
| 400 | `INVALID_JSON`, `INVALID_BODY` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN`, `ADMIN_DISABLED` |
| 404 | `NOT_FOUND` |
| 409 | `VERSION_CONFLICT` (kèm `current`), `DUPLICATE`, `INVALID_STATE`, `RECORD_DELETED`, `REQUEST_IN_PROGRESS` |
| 413 | `PAYLOAD_TOO_LARGE` (body > 50 MB) |
| 422 | `VALIDATION_ERROR` (message = `"<Label>: <error>"`, `fields = { rent: "Required" }`), `SENSITIVE_DATA`, `IMPORT_NOT_ALLOWED` |
| 423 | `PERIOD_LOCKED` (kèm `closedBefore`) |
| 428 | `PRECONDITION_REQUIRED` |

## 5. Những điểm BE đã chốt (mục 10 của spec)

1. **Định danh & giới hạn:** app public, không đăng nhập, **không gửi định danh** và **không có giới hạn nào**: xóa / xóa hàng loạt / xuất CSV / nhập CSV / số request đều không bị chặn (không có lỗi 429). `Idempotency-Key` tính theo IP + URL. Không có `/v1/me/preferences` — thiết lập chỉ lưu trên máy (spec 8.4). Bật `API_KEY` trên server khi chạy thật để API không mở công khai.
2. **`sales.property`:** giữ nguyên khi xóa tài sản (id còn, app hiện `—`).
3. **Kỳ đã chốt:** chặn cả **tạo mới** (`423`). Kỳ chốt mặc định = đầu tháng (hiện tại − 3); admin có thể chốt muộn hơn bằng `PUT /v1/config/closed-before { closedBefore }`. Xóa tài sản/đơn vị vẫn xóa theo các bản ghi `rents/expenses/revenue` thuộc kỳ đã chốt (khóa kỳ chỉ áp cho thao tác trực tiếp).
4. **Analytics:** có cả 2 giai đoạn (`all=true` cho app tự tính, và các endpoint `/analytics/*`).
5. **ContentReport:** giữ (`/v1/reports`). Bỏ trường `ref`.
6. **Múi giờ:** `America/New_York` (đổi bằng `TIMEZONE`).

Các quy tắc thêm (spec không ghi rõ):

- Xóa tài sản → `deals.property` gỡ liên kết; xóa hợp đồng → `leases.prev` của HĐ gia hạn gỡ liên kết.
- Gỡ liên kết làm `version` của bản ghi con +1 (app đang giữ bản cũ sẽ nhận `409` khi sửa).
- `units.code` không trùng trong cùng tài sản; mỗi đơn vị chỉ 1 kỳ thu / tháng → `409 DUPLICATE`.
- `workorders.unit` phải thuộc `workorders.property`; `end ≥ start` (leases), `eta ≥ start` (renovations), `maturity ≥ start` (loans).
- `zip` phải 5 chữ số (hoặc ZIP+4). `targets.index` bắt buộc 1–12 (`Month`) / 1–4 (`Quarter`), tự `null` khi `Year`. `deals.property` tự `null` khi `side = Buy`.
- `revenue.source` luôn `Manual Entry` khi tạo qua API; server **chưa** tự sinh doanh thu từ thu tiền thuê (spec chưa định nghĩa quy tắc).
- `rents.status` tính lại mỗi lần đọc; giá trị lưu trong DB được làm mới trước khi list/analytics và bởi job hằng ngày.
- **DSCR** ở `/analytics/performance` = NOI của kỳ / debt service **năm** (đúng định nghĩa 6.1). Với `period=month` số này nhỏ — app cần xác nhận có muốn quy NOI về năm không.
- **Occupancy trend:** tháng hiện tại tính từ trạng thái đơn vị; tháng trước dùng snapshot job hằng ngày ghi lại, nếu chưa có snapshot thì ước tính theo hợp đồng có hiệu lực trong tháng.

## 6. Bảng đối chiếu enum (spec tiếng Việt → API tiếng Anh)

App phải gửi/nhận **đúng chuỗi tiếng Anh** ở cột phải. Sai chuỗi → `422 VALIDATION_ERROR`.

| Trường | Tiếng Việt (spec) → Tiếng Anh (API) |
|---|---|
| `portfolios.strategy` | Dòng tiền ổn định → **Stable Cash Flow** · Giá trị gia tăng → **Value-Add** · Phát triển → **Development** · Thương mại → **Commercial** |
| `properties.type, deals.type` | Nhà ở nhiều căn → **Multifamily** · Nhà đơn lập → **Single-Family** · Thương mại → **Commercial** · Hỗn hợp → **Mixed-Use** · Đất → **Land** |
| `properties.status` | Đang sở hữu → **Owned** · Đang quản lý → **Managed** · Đang bán → **For Sale** · Đã bán → **Sold** |
| `units.type` | Studio → **Studio** · 1 phòng ngủ → **1 Bedroom** · 2 phòng ngủ → **2 Bedroom** · 3 phòng ngủ → **3 Bedroom** · Mặt bằng thương mại → **Commercial Space** |
| `units.status` | Đang thuê → **Occupied** · Trống → **Vacant** · Sắp trống → **Notice Given** · Đang sửa chữa → **Under Repair** · Ngừng cho thuê → **Off Market** |
| `units.furnish` | Không nội thất → **Unfurnished** · Một phần → **Partially Furnished** · Đầy đủ → **Furnished** |
| `leases.kind` | Theo năm → **Annual** · Theo tháng → **Month-to-Month** · Thương mại → **Commercial** |
| `leases.status` | Sắp bắt đầu → **Upcoming** · Đang hiệu lực → **Active** · Sắp hết hạn → **Expiring Soon** · Hết hạn → **Expired** · Gia hạn → **Renewed** · Chấm dứt → **Terminated** |
| `rents.status` | Chưa thu → **Unpaid** · Thu một phần → **Partially Paid** · Đã thu đủ → **Paid in Full** · Quá hạn → **Overdue** |
| `workorders.category` | Nước → **Plumbing** · Điện → **Electrical** · Điều hòa → **HVAC** · Thiết bị → **Appliances** · Mái → **Roofing** · Cảnh quan → **Landscaping** · An toàn cháy → **Fire Safety** · Khác → **Other** |
| `workorders.priority, tasks.priority` | Khẩn cấp → **Urgent** · Cao → **High** · Thường → **Normal** |
| `workorders.status` | Mới → **New** · Đã giao → **Assigned** · Đang xử lý → **In Progress** · Chờ vật tư → **Waiting for Parts** · Hoàn tất → **Completed** · Hủy → **Cancelled** |
| `vendors.service` | Điện → **Electrical** · Nước → **Plumbing** · Mái → **Roofing** · Xây dựng → **Construction** · Cảnh quan → **Landscaping** · Vệ sinh → **Cleaning** · Bảo vệ → **Security** · Điều hòa → **HVAC** |
| `vendors.status` | Đang hợp tác → **Active** · Tạm dừng → **On Hold** |
| `inspections.item` | Mái → **Roofing** · Kết cấu → **Structure** · Hệ thống điện → **Electrical System** · Cấp thoát nước → **Plumbing & Drainage** · Điều hòa → **HVAC** · An toàn cháy → **Fire Safety** · Thang máy → **Elevator** · Bãi đậu xe → **Parking Lot** · Cảnh quan → **Landscaping** |
| `inspections.result` | Tốt → **Good** · Cần theo dõi → **Needs Monitoring** · Cần sửa gấp → **Urgent Repair** |
| `renovations.status` | Dự kiến → **Planned** · Xin phép → **Permitting** · Đang thi công → **Under Construction** · Nghiệm thu → **Final Inspection** · Hoàn thành → **Completed** · Tạm dừng → **On Hold** |
| `milestones.status` | Chưa xong → **Pending** · Đã xong → **Done** |
| `tasks.status` | Chưa làm → **To Do** · Đang làm → **In Progress** · Xong → **Done** |
| `expenses.category, budgets.category` | Thuế BĐS → **Property Tax** · Bảo hiểm → **Insurance** · Tiện ích → **Utilities** · Sửa chữa & bảo trì → **Repairs & Maintenance** · Quản lý → **Management** · Quảng cáo → **Marketing** · Lãi vay → **Loan Interest** · Phí pháp lý → **Legal Fees** · Vốn hóa cải tạo → **Capital Improvements** |
| `expenses.nature` | Vận hành → **Operating** · Vốn hóa → **Capital** |
| `loans.status` | Đang trả → **Current** · Tái tài trợ → **Refinancing** · Đã tất toán → **Paid Off** |
| `loans.kind` | Cố định → **Fixed** · Thả nổi → **Floating** |
| `revenue.kind` | Tiền thuê → **Rent** · Phí giữ xe → **Parking Fees** · Giặt → **Laundry** · Phí kho → **Storage Fees** · Khác → **Other** |
| `revenue.source` | Nhập tay → **Manual Entry** · Tự sinh từ thu tiền thuê → **Auto from Rent Collection** |
| `targets.period` | Tháng → **Month** · Quý → **Quarter** · Năm → **Year** |
| `deals.side` | Mua → **Buy** · Bán → **Sell** |
| `deals.stage` | Sàng lọc → **Screening** · Phân tích → **Analysis** · Chào mua → **Offer** · Thẩm định → **Due Diligence** · Đóng giao dịch → **Closed** · Từ chối → **Rejected** |
| `checklist.item` | Pháp lý & quyền sở hữu → **Title & Ownership** · Kiểm tra tòa nhà → **Building Inspection** · Môi trường → **Environmental** · Bảo hiểm → **Insurance** · Hợp đồng thuê hiện hữu → **Existing Leases** · Thuế → **Tax** · Tài chính → **Financing** |
| `checklist.status` | Chưa kiểm → **Not Checked** · Đạt → **Passed** · Có vấn đề → **Issue Found** |
| `sales.kind` | Bán tài sản → **Property Sale** · Cho thuê đơn vị → **Unit Lease** · Gia hạn hợp đồng → **Lease Renewal** · Mua vào → **Acquisition** |
| `sales.product` | Studio → **Studio** · 1 phòng ngủ → **1 Bedroom** · 2 phòng ngủ → **2 Bedroom** · 3 phòng ngủ → **3 Bedroom** · Mặt bằng thương mại → **Commercial Space** · Nhà đơn lập → **Single-Family** · Đất → **Land** · Cả tài sản → **Whole Property** |
| `partners.kind` | Ngân hàng & bên cho vay → **Bank & Lender** · Môi giới → **Broker** · Đơn vị quản lý → **Property Manager** · Công ty bảo hiểm → **Insurance Company** · Công ty thuế → **Tax Firm** · Luật sư → **Attorney** · Bảo hiểm quyền sở hữu → **Title Insurance** · Nhà thầu → **Contractor** |
| `reports.status` | Chờ kiểm duyệt → **Pending Review** · Đã xử lý → **Resolved** |
