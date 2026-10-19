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
  /**
   * Khi giao diện và máy chủ API ở hai tên miền khác nhau (ví dụ Vercel và hosting riêng), cookie phiên SameSite=Lax không
   * được gửi qua lại. Đặt BACKEND_URL (ví dụ https://api.example.com) để chuyển /api/* sang máy chủ API cùng tên miền;
   * khi đó NEXT_PUBLIC_API_URL=/api. Không đặt BACKEND_URL thì không chuyển tiếp (chạy cục bộ).
   */
  async rewrites() {
    const backend = process.env.BACKEND_URL?.replace(/\/+$/, "");
    return backend ? [{ source: "/api/:path*", destination: `${backend}/api/:path*` }] : [];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
