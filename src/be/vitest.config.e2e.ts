import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Test chạm CSDL thật và băm mật khẩu argon2: mặc định 5 giây dễ hết giờ khi máy bận.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
