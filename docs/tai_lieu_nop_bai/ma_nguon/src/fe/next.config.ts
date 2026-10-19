import type { NextConfig } from "next";

/**
 * Tiêu đề bảo mật cho giao diện (ADR-032). Chưa đặt Content-Security-Policy vì Next.js chèn mã script nội tuyến;
 * muốn bật CSP chặt cần cấu hình nonce theo tài liệu của Next.js.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
