# Bằng chứng video: 12 luồng nghiệp vụ trên giao diện

Mỗi luồng được quay bằng trình duyệt tự động thao tác như người dùng thật (đăng nhập, bấm nút, nhập liệu), có khung đỏ quanh phần tử được bấm. Quay trên máy chủ thử cục bộ với dữ liệu mẫu, độ rộng màn hình 1366 × 768. Video định dạng `.webm`, mở được bằng Chrome, Edge, Firefox hoặc VLC.

| Mã | Luồng | Kết quả | Video | Ảnh từng bước | Điều kiện kiểm |
|---|---|---|---|---|---|
| F01 | Đăng nhập, đăng nhập sai, menu theo vai trò, đăng xuất (UC-01, UC-02) | Đạt | `video/F01-Dang-nhap-va-phan-quyen.webm` | 6 ảnh trong `anh_tung_buoc/F01-Dang-nhap-va-phan-quyen/` | 5/5 |
| F02 | Tổng quan theo góc nhìn từng vai trò (UC-19) | Đạt | `video/F02-Tong-quan-theo-vai-tro.webm` | 6 ảnh trong `anh_tung_buoc/F02-Tong-quan-theo-vai-tro/` | 3/3 |
| F03 | Giao việc đột xuất → báo cáo hoàn thành → xác nhận (UC-05, UC-06, UC-07) | Đạt | `video/F03-Giao-viec-bao-cao-xac-nhan.webm` | 13 ảnh trong `anh_tung_buoc/F03-Giao-viec-bao-cao-xac-nhan/` | 6/6 |
| F04 | Đánh giá cá nhân trọn luồng: tự chấm → thẩm định → phê duyệt (UC-09, UC-10, UC-11) | Đạt | `video/F04-Danh-gia-ca-nhan-tron-luong.webm` | 10 ảnh trong `anh_tung_buoc/F04-Danh-gia-ca-nhan-tron-luong/` | 7/7 |
| F05 | Báo cáo kỳ, xuất Excel, PDF và dự thảo Word (UC-20, UC-21) | Đạt | `video/F05-Bao-cao-xuat-tep-du-thao.webm` | 7 ảnh trong `anh_tung_buoc/F05-Bao-cao-xuat-tep-du-thao/` | 4/4 |
| F06 | Nhật ký bất biến: lọc và kiểm tra toàn vẹn chuỗi băm (UC-22) | Đạt | `video/F06-Nhat-ky-bat-bien-kiem-tra-toan-ven.webm` | 4 ảnh trong `anh_tung_buoc/F06-Nhat-ky-bat-bien-kiem-tra-toan-ven/` | 2/2 |
| F07 | Tổ chức và danh mục công việc chuẩn (UC-03, UC-04) | Đạt | `video/F07-To-chuc-va-danh-muc.webm` | 4 ảnh trong `anh_tung_buoc/F07-To-chuc-va-danh-muc/` | 4/4 |
| F08 | Đánh giá tập thể: hồ sơ phòng, bộ trục, hồ sơ Ban (UC-16, UC-17) | Đạt | `video/F08-Danh-gia-tap-the.webm` | 6 ảnh trong `anh_tung_buoc/F08-Danh-gia-tap-the/` | 5/5 |
| F09 | Tài khoản, vai trò và rà soát quyền định kỳ (UC-02, UC-23) | Đạt | `video/F09-Tai-khoan-va-ra-soat-quyen.webm` | 4 ảnh trong `anh_tung_buoc/F09-Tai-khoan-va-ra-soat-quyen/` | 1/1 |
| F10 | Giải thích điểm và mô phỏng "nếu…" của hồ sơ cá nhân (UC-18) | Đạt | `video/F10-Giai-thich-diem-va-mo-phong.webm` | 3 ảnh trong `anh_tung_buoc/F10-Giai-thich-diem-va-mo-phong/` | 1/1 |
| F11 | Hủy kết quả đã phê duyệt để xếp loại lại (UC-12) | Đạt | `video/F11-Huy-ket-qua-de-xep-loai-lai.webm` | 7 ảnh trong `anh_tung_buoc/F11-Huy-ket-qua-de-xep-loai-lai/` | 3/3 |
| F12 | OKR, đề án, lịch họp và tài liệu (UC-24, UC-25, UC-26) | Đạt | `video/F12-OKR-de-an-lich-hop-tai-lieu.webm` | 5 ảnh trong `anh_tung_buoc/F12-OKR-de-an-lich-hop-tai-lieu/` | 4/4 |

Trong bảng: "Điều kiện kiểm" là số điều kiện tự động đạt trên tổng số, ví dụ chữ hiển thị trên màn hình, trạng thái hồ sơ sau từng bước.

## Chi tiết từng luồng

### F01 Đăng nhập, đăng nhập sai, menu theo vai trò, đăng xuất (UC-01, UC-02)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Trang đăng nhập | `01-trang-dang-nhap.png` |
| 2 | Sai mật khẩu: thông báo lỗi không lộ tên nào tồn tại | `02-sai-mat-khau.png` |
| 3 | Chuyên viên: Tổng quan và menu theo vai trò | `03-chuyenvien-tong-quan.png` |
| 4 | Sau đăng xuất | `04-sau-dang-xuat.png` |
| 5 | Bấm Back: vẫn ở trang đăng nhập | `05-bam-back.png` |
| 6 | Quản trị hệ thống: menu khác hẳn chuyên viên | `06-quantri-menu.png` |

### F02 Tổng quan theo góc nhìn từng vai trò (UC-19)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | chuyenvien: góc nhìn Cá nhân | `01-tong-quan-chuyenvien.png` |
| 2 | chuyenvien: kéo xuống xem cảnh báo sớm và số liệu | `02-tong-quan-chuyenvien-duoi.png` |
| 3 | truongphong: góc nhìn Phòng | `03-tong-quan-truongphong.png` |
| 4 | truongphong: kéo xuống xem cảnh báo sớm và số liệu | `04-tong-quan-truongphong-duoi.png` |
| 5 | truongban: góc nhìn Toàn Ban | `05-tong-quan-truongban.png` |
| 6 | truongban: kéo xuống xem cảnh báo sớm và số liệu | `06-tong-quan-truongban-duoi.png` |

### F03 Giao việc đột xuất → báo cáo hoàn thành → xác nhận (UC-05, UC-06, UC-07)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Phó trưởng phòng: trang Việc được giao | `01-phophong-viec.png` |
| 2 | Điền biểu mẫu giao việc đột xuất | `02-giao-viec-form.png` |
| 3 | Điền đủ: cán bộ, tên việc, số lượng, hạn, nội dung | `03-giao-viec-form.png` |
| 4 | Đã giao: việc xuất hiện ở thẻ Tôi đã giao | `04-da-giao.png` |
| 5 | Chuyên viên thấy việc mới được giao | `05-chuyenvien-thay-viec.png` |
| 6 | Hộp báo cáo hoàn thành | `06-hop-bao-cao.png` |
| 7 | Đã nhập số lượng, ngày hoàn thành, minh chứng | `07-bao-cao-nhap.png` |
| 8 | Đã gửi báo cáo, chờ cấp trên xác nhận | `08-da-bao-cao.png` |
| 9 | Danh sách chờ xác nhận | `09-cho-xac-nhan.png` |
| 10 | Việc chờ xác nhận của cấp dưới | `10-cho-xac-nhan-loc.png` |
| 11 | Báo cáo của chuyên viên (3, đúng hạn) kèm nút Xác nhận, Từ chối | `11-bao-cao-cho-xac-nhan.png` |
| 12 | Hộp xác nhận báo cáo (nếu có) | `12-hop-xac-nhan.png` |
| 13 | Sau xác nhận: việc hoàn thành, số lượng đã xác nhận 3 | `13-da-xac-nhan.png` |

### F04 Đánh giá cá nhân trọn luồng: tự chấm → thẩm định → phê duyệt (UC-09, UC-10, UC-11)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Chuyên viên mở hồ sơ tháng 2038-02: việc đã hoàn thành 10/10, chờ tự chấm | `01-chuyenvien-mo-ho-so.png` |
| 2 | Chuyên viên chọn "Đảm bảo" cho 10 mục tiêu chí chung | `02-chuyenvien-tu-cham.png` |
| 3 | Sau khi gửi: Đã tự chấm, chờ thẩm định | `03-chuyenvien-da-gui.png` |
| 4 | Phó trưởng phòng (cấp trên trực tiếp) mở hồ sơ: thấy tự chấm của chuyên viên | `04-phophong-mo-ho-so.png` |
| 5 | Danh sách mức chất lượng | `05-phophong-chon-muc.png` |
| 6 | Đã đánh giá chất lượng và nhập nhận xét | `06-phophong-danh-gia.png` |
| 7 | Sau thẩm định: tổng điểm 100,00, đề xuất Xuất sắc | `07-phophong-da-tham-dinh.png` |
| 8 | Trưởng phòng (người phê duyệt) mở hồ sơ đã thẩm định | `08-truongphong-mo-ho-so.png` |
| 9 | Hộp phê duyệt: ý kiến (tùy chọn); bên dưới là khối hạn mức xuất sắc dành riêng cho người phê duyệt | `09-hop-phe-duyet.png` |
| 10 | Sau phê duyệt: hồ sơ khóa, có nút Hủy kết quả | `10-truongphong-da-phe-duyet.png` |

### F05 Báo cáo kỳ, xuất Excel, PDF và dự thảo Word (UC-20, UC-21)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Danh sách kỳ để chọn | `01-chon-ky.png` |
| 2 | Đã chọn kỳ năm 2033 trong danh sách | `02-chon-2033.png` |
| 3 | Báo cáo kỳ năm 2033: bảng điểm, phân bố xếp loại, theo đơn vị | `03-bao-cao-ky-2033.png` |
| 4 | Đã bấm Xuất Excel (tệp lưu cùng thư mục) | `04-xuat-excel.png` |
| 5 | Đã bấm Xuất PDF | `05-xuat-pdf.png` |
| 6 | Dự thảo quyết định: nội dung điền sẵn theo hồ sơ đã duyệt, có dấu DỰ THẢO | `06-du-thao-quyet-dinh.png` |
| 7 | Đã tải dự thảo Word | `07-du-thao-word.png` |

Tệp tải về trong lúc quay: `bao-cao-danh-gia-2033.pdf`, `bao-cao-danh-gia-2033.xlsx`, `du-thao-quyet-dinh-2033.docx`.

### F06 Nhật ký bất biến: lọc và kiểm tra toàn vẹn chuỗi băm (UC-22)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Nhật ký hoạt động | `01-nhat-ky.png` |
| 2 | Kết quả kiểm tra toàn vẹn chuỗi băm | `02-kiem-tra-toan-ven.png` |
| 3 | Chi tiết một bản ghi: người, thời điểm, IP, mã yêu cầu, mã băm | `03-chi-tiet-ban-ghi.png` |
| 4 | Quản trị hệ thống mở /audit-logs: không có dữ liệu nhật ký | `04-quantri-khong-xem-duoc.png` |

### F07 Tổ chức và danh mục công việc chuẩn (UC-03, UC-04)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Màn hình /org-chart | `01-so-do-to-chuc.png` |
| 2 | Màn hình /organization | `02-quan-ly-to-chuc.png` |
| 3 | Màn hình /catalog | `03-danh-muc.png` |
| 4 | Màn hình /catalog/fddda56a-9907-442a-909d-fe274388762f | `04-danh-muc-chi-tiet.png` |

### F08 Đánh giá tập thể: hồ sơ phòng, bộ trục, hồ sơ Ban (UC-16, UC-17)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Trưởng phòng: /unit-evaluations | `01-danh-sach-tap-the.png` |
| 2 | Trưởng phòng: /unit-evaluations/fca63a97-0327-4c55-832c-350dc15af613 | `02-ho-so-tap-the.png` |
| 3 | Trưởng phòng: kéo xuống xem các trục chấm | `03-ho-so-tap-the-truc.png` |
| 4 | Văn phòng: /unit-evaluations/axes | `04-cau-hinh-truc.png` |
| 5 | Văn phòng: /reports/units | `05-bao-cao-tap-the.png` |
| 6 | Đại diện Ban Thường vụ: /unit-evaluations | `06-thuong-vu.png` |

### F09 Tài khoản, vai trò và rà soát quyền định kỳ (UC-02, UC-23)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Danh sách tài khoản | `01-tai-khoan.png` |
| 2 | Chi tiết tài khoản: vai trò, thời hạn, gắn cán bộ | `02-chi-tiet-tai-khoan.png` |
| 3 | Danh sách đợt rà soát quyền | `03-ra-soat-quyen.png` |
| 4 | Chi tiết đợt rà soát: từng vai trò, người phụ trách, hạn | `04-chi-tiet-ra-soat.png` |

### F10 Giải thích điểm và mô phỏng "nếu…" của hồ sơ cá nhân (UC-18)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Hồ sơ đánh giá kỳ 2026-M10 | `01-ho-so.png` |
| 2 | Điểm đến từ đâu: từng thành phần A, B, C | `02-diem-den-tu-dau.png` |
| 3 | Mô phỏng "nếu…" không ghi vào hồ sơ | `03-mo-phong.png` |

### F11 Hủy kết quả đã phê duyệt để xếp loại lại (UC-12)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Hồ sơ đã phê duyệt (100,00 Xuất sắc), khóa chỉnh sửa | `01-ho-so-da-duyet.png` |
| 2 | Khu vực "Hủy kết quả để xếp loại lại" | `02-khu-vuc-huy.png` |
| 3 | Hộp hủy kết quả: lý do và căn cứ | `03-hop-huy.png` |
| 4 | Chọn lý do "Sai số liệu" và nêu căn cứ (từ 10 ký tự) | `04-dien-ly-do.png` |
| 5 | Sau hủy: hồ sơ về bước làm lại | `05-sau-huy.png` |
| 6 | Lịch sử hủy kết quả: thời điểm, lý do, căn cứ, kết quả cũ (100,00 Xuất sắc) | `06-lich-su-huy.png` |
| 7 | Chuyên viên thấy hồ sơ quay về chờ tự chấm để làm lại | `07-chuyenvien-lam-lai.png` |

### F12 OKR, đề án, lịch họp và tài liệu (UC-24, UC-25, UC-26)

| Bước | Việc làm | Ảnh |
|---|---|---|
| 1 | Chuyên viên: /okr | `01-okr.png` |
| 2 | Chuyên viên: /projects | `02-de-an.png` |
| 3 | Chuyên viên: /meetings | `03-lich-hop.png` |
| 4 | Chuyên viên: /documents | `04-tai-lieu.png` |
| 5 | Chuyên viên: chuông thông báo | `05-thong-bao.png` |

