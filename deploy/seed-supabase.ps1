# Nạp dữ liệu trình diễn vào PostgreSQL trên Supabase từ máy của bạn.
# Mật khẩu được hỏi khi chạy, không lưu vào tệp. Chạy tại thư mục gốc của dự án:  .\deploy\seed-supabase.ps1
# Chỉ dùng cho bản demo, không dùng cho môi trường thật.

$ErrorActionPreference = 'Stop'

$ref = Read-Host 'Mã dự án Supabase (ví dụ uttdmtfatkcuctavsshn)'
$poolerHost = Read-Host 'Host session pooler (Supabase > Connect > Session pooler, ví dụ aws-0-us-west-2.pooler.supabase.com)'
$dbPass = Read-Host 'Mật khẩu cơ sở dữ liệu' -AsSecureString
$adminPass = Read-Host 'Mật khẩu tài khoản quantri sắp tạo (từ 12 ký tự)' -AsSecureString
function Plain($s) { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }

$env:DB_HOST = $poolerHost
$env:DB_PORT = '5432'
$env:DB_USER = "postgres.$ref"
$env:DB_NAME = 'postgres'
$env:DB_PASSWORD = Plain $dbPass
$env:DB_SSL = 'true'
$env:DB_SSL_REJECT_UNAUTHORIZED = 'false'
$env:ADMIN_USERNAME = 'quantri'
$env:ADMIN_PASSWORD = Plain $adminPass
# Các biến S3 chỉ cần khi chạy lệnh có đụng tới kho tệp; các lệnh dưới đây không cần.

Set-Location "$PSScriptRoot\..\src\be"
npm install
npm run build

npm run create-admin
npm run import-org -- "..\..\docs\tai_lieu_nop_bai\ma_nguon\du_lieu_mau\Co-cau-to-chuc.xlsx"
npm run import-catalog -- "..\..\docs\tai_lieu_nop_bai\ma_nguon\du_lieu_mau\Danh-muc-cong-viec.xlsx" --label "Bản nháp từ Excel 27.9.2026"
npm run seed-demo -- --approve-catalog
npm run seed-demo-periods
npm run seed-demo-scenarios

Write-Host 'Xong. Mật khẩu các tài khoản demo chỉ in một lần ở phần seed-demo phía trên; hãy lưu lại.'
