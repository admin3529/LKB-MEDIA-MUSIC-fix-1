# LKB Media Music — cổng cấp phép cho Playlist Mix Builder

Gói này biến bản HTML thành một website có kiểm tra key ở máy chủ:

- Trang chính chỉ mở ứng dụng khi có key hợp lệ.
- Mã có hạn bắt đầu tính từ lần kích hoạt đầu tiên: 1, 3 hoặc 6 tháng; loại vĩnh viễn không hết hạn.
- Một key chỉ có một phiên sử dụng cùng lúc. Đăng nhập key ở thiết bị khác sẽ thay phiên cũ.
- Cổng quản trị riêng nằm ở /lkb-media-console; username là LKB Media Music.
- Quản trị viên xem danh sách, ghi chú người nhận, khóa/mở khóa key, tạo key lẻ và nhập/xuất CSV.
- Key được băm để xác minh và mã hóa trong cơ sở dữ liệu. Mật khẩu quản trị và khóa mã hóa được đặt bằng Cloudflare Secrets, không nhúng vào HTML.
- Khi quản trị viên khóa key, ứng dụng đang mở sẽ khóa lại ở lần kiểm tra máy chủ tiếp theo, tối đa khoảng 3 phút.

## Dùng dịch vụ miễn phí

Website chạy trên Cloudflare Workers và D1, không cần mua tên miền để bắt đầu. Sau khi deploy, Cloudflare cấp địa chỉ dạng https://lkb-media-music.<subdomain>.workers.dev. Gói miễn phí hiện có giới hạn sử dụng hàng ngày; nếu vượt ngưỡng, các API xác minh có thể tạm ngừng đến khi quota làm mới. Xem giới hạn hiện tại trong tài liệu Cloudflare trước khi đưa lượng người dùng lớn vào.

Website cần Worker chạy trước các file tĩnh để chặn đường dẫn ứng dụng nội bộ nếu chưa có key. Vì vậy hãy deploy bằng Wrangler ở bước dưới đây; không tải riêng thư mục public bằng cách kéo-thả.

## Cài và deploy

1. Tạo tài khoản Cloudflare miễn phí và cài Node.js LTS trên máy. Mở PowerShell tại thư mục LKB-Media-Music-Portal.
2. Đăng nhập Wrangler:

       npx wrangler login

3. Tạo cơ sở dữ liệu:

       npx wrangler d1 create lkb-media-music

   Lệnh trả về một database_id. Mở wrangler.jsonc, thay REPLACE_WITH_D1_DATABASE_ID bằng ID vừa nhận, rồi lưu file.

4. Tạo các bảng:

       npx wrangler d1 execute lkb-media-music --remote --file=./schema.sql

5. Tạo mật khẩu quản trị dưới dạng Secret:

       npx wrangler secret put ADMIN_PASSWORD

   Khi Wrangler hỏi, nhập mật khẩu. Tài khoản là LKB Media Music; mật khẩu LKB theo yêu cầu của bạn, nhưng nên đổi thành mật khẩu dài và riêng trước khi chia sẻ website công khai.

6. Tạo khóa mã hóa 32 byte trong PowerShell:

       $bytes = New-Object byte[] 32
       $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
       $generator.GetBytes($bytes)
       [Convert]::ToBase64String($bytes)

   Sao chép chuỗi vừa tạo, rồi chạy:

       npx wrangler secret put KEY_ENCRYPTION_KEY

   Dán chuỗi vào dấu nhắc của Wrangler. Cất bản dự phòng an toàn; nếu mất khóa này, những key đã mã hóa trong D1 không thể giải mã để quản trị/xuất lại.

7. Đưa website lên:

       npx wrangler deploy

   Wrangler sẽ yêu cầu đăng nhập nếu cần và hướng dẫn bật địa chỉ workers.dev. Website chưa cần tên miền riêng.

## Deploy qua GitHub và Workers Builds

Nếu kết nối GitHub với Cloudflare, hãy chọn **Workers Builds** cho Worker (không dùng tải tệp tĩnh kiểu Pages). Trong kho GitHub, thư mục được chọn làm **Root directory** phải chứa trực tiếp các mục sau:

    wrangler.jsonc
    package.json
    schema.sql
    src/index.js
    public/index.html
    public/admin-internal.html
    public/player-internal.html

Trong Cloudflare mở **Workers & Pages → chọn Worker → Settings → Builds**. Đặt **Deploy command** là `npx wrangler deploy`; để **Build command** trống. Đặt **Root directory**:

- Để trống hoặc `.` nếu các tệp ở ngay thư mục gốc kho GitHub.
- Nhập đường dẫn tương đối, ví dụ `LKB-Media-Music-Portal`, nếu toàn bộ dự án nằm trong thư mục con đó.

Không đặt Root directory thành `public`. Nếu kho GitHub chỉ có một file ZIP hoặc một file HTML, hãy giải nén gói này và đưa toàn bộ các tệp bên trong thư mục `LKB-Media-Music-Portal` lên kho GitHub. Tên Worker trên Cloudflare phải là `lkb-media-music`, khớp với trường `name` trong `wrangler.jsonc`. Trước khi build, thay `REPLACE_WITH_D1_DATABASE_ID` trong `wrangler.jsonc` bằng ID D1 thật.

Sau khi lưu cấu hình và cập nhật kho GitHub, chạy lại **Retry build**. Không đặt file CSV chứa key trong kho GitHub.

## Nạp 103 key đã tạo

Sau khi deploy, mở địa chỉ website cộng thêm /lkb-media-console, đăng nhập, bấm Chọn CSV key và chọn file riêng:

    LKB-Media-Music-private-keys-103.csv

File CSV có đúng 30 mã 1 tháng, 20 mã 3 tháng, 40 mã 6 tháng và 13 mã vĩnh viễn. Hạn dùng chỉ bắt đầu khi người nhận kích hoạt. Sau khi nhập, quản trị viên có thể ghi tên/người nhận vào cột ghi chú và tải lại danh sách CSV. Giữ file CSV này riêng tư; đừng đặt nó trong thư mục public hoặc gửi lên kho mã nguồn.

## Đường dẫn quản trị

    https://<địa-chỉ-worker-của-bạn>/lkb-media-console

Đường dẫn không hiện trên trang chính, nhưng bản thân ẩn URL không phải lớp bảo vệ; đăng nhập máy chủ mới là lớp bảo vệ. Không dùng mật khẩu ngắn LKB trên website công khai nếu có thể tránh.

## Giới hạn cần biết

Phần mềm vẫn xử lý nhạc ở trình duyệt. Người đã vào được website có thể xem mã giao diện mà trình duyệt tải xuống; không có cách mã hóa HTML/JavaScript để ngăn tuyệt đối việc sao chép. Thiết kế này bảo vệ việc cấp key, cơ sở dữ liệu, trang quản trị và quyền vào website; nó không biến mã trình duyệt thành phần mềm bí mật.
