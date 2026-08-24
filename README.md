# Sao Mai Hotel Revenue V1

Web quản lý và phân bổ doanh thu phòng hằng ngày cho khách ngắn hạn, theo tháng và theo năm.

## Nghiệp vụ chính V1

- Khách chưa checkout vẫn được ghi nhận doanh thu phòng theo từng ngày báo cáo.
- Giá tháng mặc định chia theo số ngày thực tế của tháng: 28/29/30/31 ngày.
- Có tùy chọn hợp đồng cố định chia 30 ngày hoặc giá năm chia 365/366 ngày.
- Khi checkout, có thể:
  - giữ giá hợp đồng;
  - chuyển sang giá ngày fallback;
  - nhập tổng quyết toán thực tế.
- Nếu doanh thu đã báo trước khác tổng quyết toán, hệ thống tạo **Adjustment vào ngày checkout**, không sửa ngược các ngày đã chốt.
- Báo cáo ngày có thể **Chốt ngày**. Sau khi chốt, dòng doanh thu của ngày đó bị khóa.
- Theo dõi dịch vụ: minibar, laundry, restaurant, extra bed, breakfast, khác.
- Dashboard ngày + lũy kế tháng.

## Cấu trúc

- `public/`: giao diện SPA.
- `src/index.js`: Cloudflare Worker API + logic doanh thu.
- `schema.sql`: D1 schema.
- `wrangler.jsonc`: cấu hình Worker + D1 + Assets.

## Triển khai

1. Tạo GitHub repository: `saomai-hotel-revenue`.
2. Tạo Cloudflare D1 database: `saomai-hotel-revenue-db`.
3. Vào D1 Console, chạy toàn bộ `schema.sql`.
4. Copy **Database ID** của D1 và thay vào `wrangler.jsonc` tại `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
5. Kết nối repository với Cloudflare Workers & Pages.
6. Deploy command: `npx wrangler deploy`.
7. Khi Worker đã deploy, kiểm tra tab Bindings có:
   - `DB` -> `saomai-hotel-revenue-db`
   - `ASSETS`

## Quy tắc ngày doanh thu

V1 dùng khái niệm **revenue_date = ngày kết thúc đêm lưu trú**.
Ví dụ check-in 01/08 và checkout 02/08 = 1 đêm, doanh thu được ghi vào ngày 02/08.

## Giá tháng theo ngày thực tế

Ví dụ giá tháng 16.000.000đ:
- tháng 8 có 31 ngày -> 516.129đ/ngày;
- tháng 9 có 30 ngày -> 533.333đ/ngày;
- tháng 2/2027 có 28 ngày -> 571.429đ/ngày;
- tháng 2/2028 có 29 ngày -> 551.724đ/ngày.

## Checkout sớm / đổi sang giá ngày

Ví dụ doanh thu đã báo 4.500.000đ, tổng đúng sau checkout là 7.000.000đ:
- hệ thống giữ nguyên các ngày cũ;
- tạo Adjustment `+2.500.000đ` vào ngày checkout.

Nếu tổng đúng thấp hơn số đã báo, Adjustment có thể là số âm.


## V1.2 - Vé bơi & dịch vụ
- Bổ sung VBN, VBL, VBT lớn, VBT nhỏ, Vé Golf, Vé học bơi, Vé Gym tháng, Tennis ngày.
- Form dịch vụ có Số lượng, Đơn giá, Thành tiền.
- Worker tự bổ sung cột quantity/unit_price vào D1 hiện tại ở lần gọi API dịch vụ đầu tiên.
- Báo cáo ngày/tháng tách Vé bơi và Dịch vụ khác.


## V1.5.1
- Fix hiển thị dấu tiếng Việt ở tiêu đề bằng font hệ thống hỗ trợ tiếng Việt tốt hơn.
- Chuẩn hóa toàn bộ source text sang UTF-8 NFC.


## V1.6 – Chuyển phòng liên tục
- Thêm nút **Chuyển phòng** cho khách đang ở.
- Một booking có thể có nhiều chặng phòng/hạng phòng.
- Chuyển phòng không reset số ngày lưu trú và không tự chuyển khách tháng sang giá ngày.
- Mỗi chặng dùng giá hợp đồng của hạng phòng tương ứng.
- Báo cáo ngày lưu snapshot phòng/hạng phòng nên ngày cũ vẫn nằm đúng hạng phòng cũ sau khi khách chuyển phòng.
- Worker tự tạo bảng `stay_segments` và bổ sung các cột snapshot cần thiết; không cần chạy SQL thủ công.

## V1.7 – Front Office Payment & Checkout Flow
- Ngày dự kiến checkout là tùy chọn; để trống thì khách tiếp tục ở và doanh thu tiếp tục chạy.
- Nút Thu tiền ngay trên hồ sơ đang ở, không nhập lại khách.
- Lịch sử thanh toán + Phát sinh / Đã thu / Còn phải thu.
- Cọc thêm / Thanh toán trong thời gian ở; Tiền mặt / Chuyển khoản / Thẻ.
- In bill sau mỗi lần thu.
- Checkout có quyết toán và DailyPayment.
- Sau checkout, lễ tân không ghi nhận thêm khoản thu.

## V1.7.1 – Live Daily Revenue Fix
- Mở **Doanh thu theo ngày** hoặc bấm **Xem** sẽ tự sinh và hiển thị doanh thu của khách đang ở đến ngày được chọn.
- **Không cần Chốt ngày để thấy doanh thu**.
- Nút **Chốt ngày** chỉ khóa số liệu ngày đó.
- Sửa lỗi gọi `ensureLedgerThrough` thiếu biến `env` trong phần tính tình trạng thanh toán.

## V1.7.2 – Daily Report Fix
- Báo cáo ngày chỉ sinh dữ liệu đúng ngày đang xem, không quét toàn bộ lịch sử.
- API nhận được cả DD/MM/YYYY và YYYY-MM-DD.
- Giao diện luôn đổi ngày DD/MM/YYYY sang ISO trước khi gọi API.
- Không cần chốt ngày để thấy doanh thu.
