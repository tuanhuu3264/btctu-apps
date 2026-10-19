#!/bin/sh
# Sinh chứng chỉ tự ký (chỉ để chạy thử). Chạy trong container alpine/openssl, ghi vào /certs. Không ghi đè nếu đã có.
set -eu
if [ -s /certs/fullchain.pem ] && [ -s /certs/privkey.pem ]; then
  echo "Đã có chứng chỉ trong /certs, bỏ qua."
  exit 0
fi
openssl req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes \
  -keyout /certs/privkey.pem -out /certs/fullchain.pem \
  -subj "/CN=${CERT_CN:-localhost}/O=KPI thu nghiem" \
  -addext "subjectAltName=${CERT_SAN:-DNS:localhost}"
chmod 644 /certs/fullchain.pem
chmod 640 /certs/privkey.pem || true
echo "Đã sinh chứng chỉ tự ký (365 ngày) tại deploy/nginx/certs. Chỉ dùng thử, không dùng cho vận hành thật."
