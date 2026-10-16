import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { applyHttpSecurity, securityOptionsFromEnv } from './common/http-security.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const security = securityOptionsFromEnv();
  // CORS đặt trước để cả phản hồi 429 của bộ giới hạn tần suất vẫn mang tiêu đề CORS và giao diện đọc được thông báo.
  app.enableCors({ origin: security.frontendOrigin, credentials: true });
  applyHttpSecurity(app, security);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
