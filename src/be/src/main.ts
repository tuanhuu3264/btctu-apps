import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { applyHttpSecurity, securityOptionsFromEnv } from './common/http-security.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const security = securityOptionsFromEnv();
  // CORS đặt trước để cả phản hồi 429 của bộ giới hạn tần suất vẫn mang tiêu đề CORS và giao diện đọc được thông báo.
  app.enableCors({ origin: security.frontendOrigin, credentials: true });
  applyHttpSecurity(app, security);
  // Ghi các phản hồi 403, 429 và lỗi máy chủ (mã, đường dẫn, IP) để biết lỗi đến từ ứng dụng hay từ lớp phía trước.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      const s = res.statusCode;
      if (s === 403 || s === 429 || s >= 500) Logger.warn(`${req.method} ${req.originalUrl.split('?')[0]} -> ${s} (ip ${req.ip})`, 'HttpStatus');
    });
    next();
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 4000);
}
// Không dùng await ở cấp tệp: trình nạp của hosting (lsnode) nạp tệp này bằng require(), không chịu được top-level await.
bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
