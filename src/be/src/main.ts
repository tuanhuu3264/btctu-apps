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
  // Tạm thời để chẩn đoán IP khách phía sau proxy: chỉ ghi khi yêu cầu có tiêu đề X-Debug-IP, không ghi nội dung khác.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.headers['x-debug-ip']) {
      const h = req.headers;
      Logger.log(
        `IP-DEBUG req.ip=${req.ip} socket=${req.socket.remoteAddress} xff="${h['x-forwarded-for'] ?? ''}" real-ip="${h['x-real-ip'] ?? ''}" vercel-xff="${h['x-vercel-forwarded-for'] ?? ''}" cf="${h['cf-connecting-ip'] ?? ''}" forwarded="${h['forwarded'] ?? ''}"`,
        'IpDebug',
      );
    }
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
