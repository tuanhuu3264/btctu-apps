# Hồ sơ nộp: Phần mềm quản lý, đánh giá kết quả thực hiện nhiệm vụ bằng KPI/OKR

Ban Tổ chức Tỉnh ủy Đắk Lắk, đề kiểm tra năng lực vị trí công nghệ thông tin.

## Đọc theo thứ tự này

| Thứ tự | Thư mục | Tệp | Nội dung |
|---|---|---|---|
| 1 | (thư mục gốc) | `Van-ban-tra-loi-de-kiem-tra-nang-luc.docx` | **Văn bản trả lời cả ba yêu cầu của đề.** Có phần tóm tắt, thuật ngữ, Phần 1 (bộ tiêu chí), Phần 2 (phần mềm), Phần 3 (an toàn thông tin) và hai phụ lục đầy đủ |
| 1b | (thư mục gốc) | `Slide-thuyet-trinh.pptx` | Bộ 22 slide thuyết trình: yêu cầu 1, yêu cầu 2 (slide 3) và yêu cầu 3 |
| 2 | `tai_lieu_ve_tinh_diem` | `Bo-tieu-chi-KPI-OKR-va-cach-tinh-diem.docx` | Yêu cầu 1 bản đầy đủ: bộ tiêu chí cá nhân, tập thể, từng phòng, công thức tính điểm, xếp loại |
| 3 | `tai_lieu_chuc_nang_ung_dung` | `BRD-Tai-lieu-yeu-cau-nghiep-vu.docx`, `SRS-Dac-ta-yeu-cau-phan-mem.docx` | Yêu cầu 2: nhu cầu nghiệp vụ và đặc tả từng chức năng của phần mềm (139 yêu cầu chức năng, yêu cầu phi chức năng, ma trận quyền) |
| 4 | `tai_lieu_bao_mat` | `Phuong-an-ATTT-cap-do-3.docx` | Yêu cầu 3: xác định cấp độ an toàn thông tin, căn cứ pháp lý, phương án bảo đảm |
| 5 | `huong_dan_trien_khai_ung_dung` | `Huong-dan-trien-khai-va-van-hanh.docx` | Cách cài đặt, nạp dữ liệu, sao lưu, nâng cấp, xử lý sự cố |
| 6 | `bang_chung_kiem_thu` | xem bên dưới | Bộ kiểm thử, kết quả 202 tình huống, bằng chứng từng ca |
| 7 | `bang_chung_video` | `README.md`, `video/`, `anh_tung_buoc/` | **12 video** các luồng nghiệp vụ trên giao diện thật, kèm ảnh từng bước |

## Bằng chứng kiểm thử (`bang_chung_kiem_thu`)

| Tệp | Nội dung |
|---|---|
| `1-Bo-kiem-thu-nghiem-thu.docx` | 28 use case, 139 tiêu chí chấp nhận, 202 test case, ma trận truy vết |
| `2-Bao-cao-ket-qua-nghiem-thu.docx` | Kết quả: 202/202 đạt (lần chạy đầu 201, một lỗi mức Cao đã sửa và chạy lại đạt); chỗ tài liệu test lệch với hệ thống; giới hạn của lần kiểm |
| `3-Phieu-ket-qua-202-test-case.xlsx` | Phiếu kết quả từng test case (Đạt/Không đạt, kết quả thực tế), tổng hợp theo use case, danh sách lỗi |
| `4-Tep-xuat-mau/` | Tệp thật do hệ thống xuất khi kiểm thử: báo cáo Excel, PDF, dự thảo Word, bảng rà soát quyền |
| `5-Evidence-tung-test-case.zip` | Evidence từng test case: mỗi test case một tệp JSON ghi các lời gọi, phản hồi, từng điều kiện kiểm và giá trị thực tế (mật khẩu đã che); kèm kết quả tổng hợp |

## Bằng chứng video (`bang_chung_video`)

12 luồng: đăng nhập và phân quyền; tổng quan theo vai trò; giao việc, báo cáo, xác nhận; đánh giá cá nhân trọn luồng (tự chấm, thẩm định, phê duyệt); báo cáo, xuất tệp, dự thảo; nhật ký bất biến và kiểm tra toàn vẹn; tổ chức và danh mục; đánh giá tập thể; tài khoản và rà soát quyền; giải thích điểm và mô phỏng; hủy kết quả để xếp loại lại; OKR, đề án, lịch họp, tài liệu. Danh sách, kết quả kiểm và từng bước nằm ở `bang_chung_video/README.md`. Video định dạng `.webm`, mở bằng Chrome, Edge, Firefox hoặc VLC.

## Mã nguồn và tài liệu thiết kế

Mã nguồn phần mềm nằm trong thư mục `ma_nguon/`: máy chủ `src/be`, giao diện `src/fe`, cấu hình dựng sẵn ở `database/` và `deploy/`, mục lục mã ở `SOURCE_INDEX.md`. Thư mục này không kèm thư viện cài sẵn (`node_modules`), tệp dựng sẵn và tệp cấu hình chứa bí mật; cài đặt và chạy theo `huong_dan_trien_khai_ung_dung`.

## Lưu ý khi đọc

- **Sử dụng AI:** có dùng công cụ AI (Claude) hỗ trợ viết mã, chạy kiểm thử tự động và soạn tài liệu. Người dự thi đã đọc, kiểm tra, chịu trách nhiệm và phê duyệt nội dung nộp. Phần mềm không dùng AI để tính điểm hay xếp loại.
- Phần nào văn bản của Đảng, Nhà nước chưa quy định rõ, hồ sơ đã ghi rõ là "đề xuất" để cơ quan có thẩm quyền quyết định.
- Kết quả kiểm thử là kiểm thử kỹ thuật của người làm phần mềm, chưa thay cho nghiệm thu của người dùng nghiệp vụ. Phần kiểm thử giao diện còn sơ bộ.
- Video và ảnh quay trên máy chủ thử cục bộ, dữ liệu mẫu.
