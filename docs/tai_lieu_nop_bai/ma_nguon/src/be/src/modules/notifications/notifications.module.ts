import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { Notifier } from '../../common/notifier.js';
import { SecurityModule } from '../security/index.js';
import { NotificationRepository } from './application/notification.ports.js';
import { NotificationService } from './application/notification.service.js';
import { NotificationEntity } from './data-access/notification.entity.js';
import { TypeOrmNotificationRepository } from './data-access/typeorm-notification.repository.js';
import { NotificationController } from './presentation/notification.controller.js';

/** Thông báo trong hệ thống (ADR-029). Toàn cục để các mô-đun nghiệp vụ chỉ cần inject cổng `Notifier`. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity]), SecurityModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    { provide: Notifier, useExisting: NotificationService },
    { provide: NotificationRepository, useClass: TypeOrmNotificationRepository },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [Notifier, NotificationService],
})
export class NotificationsModule {}
