import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { OrganizationModule } from '../organization/index.js';
import { ProjectModule } from '../project/index.js';
import { SecurityModule } from '../security/index.js';
import { FileStorage, S3FileStorage } from '../tasking/index.js';
import { ActionRepository, AttendeeRepository, MeetingAttachmentRepository, MeetingOrgDirectory, MeetingProjectDirectory, MeetingRepository, RoomRepository } from './application/meeting.ports.js';
import { MeetingService } from './application/meeting.service.js';
import { OrganizationDirectoryAdapter, ProjectDirectoryAdapter } from './data-access/directories.js';
import { MeetingActionEntity, MeetingAttachmentEntity, MeetingAttendeeEntity, MeetingEntity, MeetingRoomEntity } from './data-access/meeting.entities.js';
import { TypeOrmActionRepository, TypeOrmAttendeeRepository, TypeOrmMeetingAttachmentRepository, TypeOrmMeetingRepository, TypeOrmRoomRepository } from './data-access/typeorm-meeting.repositories.js';
import { MeetingController } from './presentation/meeting.controller.js';

/** Lịch họp (ADR-051). Dùng đề án (một chiều) và kho tệp S3 chung. */
@Module({
  imports: [TypeOrmModule.forFeature([MeetingEntity, MeetingRoomEntity, MeetingAttendeeEntity, MeetingActionEntity, MeetingAttachmentEntity]), SecurityModule, OrganizationModule, ProjectModule],
  controllers: [MeetingController],
  providers: [
    MeetingService,
    { provide: Clock, useClass: SystemClock },
    { provide: MeetingRepository, useClass: TypeOrmMeetingRepository },
    { provide: RoomRepository, useClass: TypeOrmRoomRepository },
    { provide: AttendeeRepository, useClass: TypeOrmAttendeeRepository },
    { provide: ActionRepository, useClass: TypeOrmActionRepository },
    { provide: MeetingAttachmentRepository, useClass: TypeOrmMeetingAttachmentRepository },
    { provide: MeetingOrgDirectory, useClass: OrganizationDirectoryAdapter },
    { provide: MeetingProjectDirectory, useClass: ProjectDirectoryAdapter },
    { provide: FileStorage, useClass: S3FileStorage },
  ],
  exports: [MeetingService],
})
export class MeetingModule {}
