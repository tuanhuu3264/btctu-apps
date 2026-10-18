import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthorizationService, Authenticated, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import { fileResponseHeaders, MAX_FILE_BYTES } from '../../tasking/index.js';
import { MeetingService } from '../application/meeting.service.js';
import type { Caps, ConflictView, MeetingDetail, MeetingRow, MyAction, RoomConflictView } from '../application/meeting.service.js';
import type { ActionModel, AttendeeModel, MeetingModel, RoomModel } from '../application/meeting.model.js';
import { ActionDto, CheckConflictsDto, CheckRoomDto, RoomDto, RoomQueryDto, UpdateRoomDto, ConcludeDto, ConclusionDto, CreateMeetingDto, MeetingQueryDto, ReasonDto, RespondDto, UpdateActionDto, UpdateMeetingDto } from './meeting.dto.js';

interface UploadedMulterFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/** Lịch họp (ADR-051): ai đã gắn với cán bộ đều dùng được; quyền theo người tạo, chủ trì, người được mời kiểm tra ở lớp nghiệp vụ. */
@Controller('meetings')
export class MeetingController {
  constructor(
    private readonly meetings: MeetingService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async caps(actor: CurrentAccountModel): Promise<Caps> {
    return { readAll: (await this.authorization.permissionsOf(actor.id)).has('meeting:read-all') };
  }

  @Get()
  @Authenticated()
  async list(@CurrentAccount() actor: CurrentAccountModel, @Query() query: MeetingQueryDto): Promise<MeetingRow[]> {
    return this.meetings.list(actor, await this.caps(actor), query);
  }

  @Post('check-conflicts')
  @HttpCode(200)
  @Authenticated()
  async checkConflicts(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: CheckConflictsDto): Promise<ConflictView[]> {
    return this.meetings.checkConflicts(actor, await this.caps(actor), dto);
  }

  /** Phòng họp để chọn (dữ liệu tham chiếu). */
  @Get('rooms')
  @Authenticated()
  listRooms(@Query() query: RoomQueryDto): Promise<RoomModel[]> {
    return this.meetings.listRooms(query.includeInactive === 'true');
  }

  @Post('rooms')
  @RequirePermission('meeting:manage-rooms')
  createRoom(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: RoomDto): Promise<RoomModel> {
    return this.meetings.createRoom(actor, dto);
  }

  @Patch('rooms/:roomId')
  @RequirePermission('meeting:manage-rooms')
  updateRoom(@CurrentAccount() actor: CurrentAccountModel, @Param('roomId', ParseUUIDPipe) roomId: string, @Body() dto: UpdateRoomDto): Promise<RoomModel> {
    return this.meetings.updateRoom(actor, roomId, dto);
  }

  /** Xem trước cuộc họp khác dùng cùng phòng vào giờ này. */
  @Post('check-room')
  @HttpCode(200)
  @Authenticated()
  async checkRoom(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: CheckRoomDto): Promise<RoomConflictView[]> {
    return this.meetings.checkRoom(actor, await this.caps(actor), dto);
  }

  @Get('my-actions')
  @Authenticated()
  myActions(@CurrentAccount() actor: CurrentAccountModel): Promise<MyAction[]> {
    return this.meetings.myActions(actor);
  }

  @Post()
  @Authenticated()
  async create(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: CreateMeetingDto): Promise<{ meeting: MeetingModel; conflicts: ConflictView[]; roomConflicts: RoomConflictView[] }> {
    return this.meetings.create(actor, await this.caps(actor), dto);
  }

  @Get(':id')
  @Authenticated()
  async get(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<MeetingDetail> {
    return this.meetings.get(actor, id, await this.caps(actor));
  }

  @Patch(':id')
  @Authenticated()
  async update(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMeetingDto): Promise<{ meeting: MeetingModel; conflicts: ConflictView[]; roomConflicts: RoomConflictView[] }> {
    return this.meetings.update(actor, await this.caps(actor), id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Authenticated()
  cancel(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto): Promise<MeetingModel> {
    return this.meetings.cancel(actor, id, dto.reason);
  }

  @Post(':id/respond')
  @HttpCode(200)
  @Authenticated()
  respond(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto): Promise<AttendeeModel> {
    return this.meetings.respond(actor, id, dto);
  }

  @Post(':id/conclude')
  @HttpCode(200)
  @Authenticated()
  conclude(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConcludeDto): Promise<MeetingModel> {
    return this.meetings.conclude(actor, id, dto);
  }

  @Patch(':id/conclusion')
  @Authenticated()
  updateConclusion(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConclusionDto): Promise<MeetingModel> {
    return this.meetings.updateConclusion(actor, id, dto.conclusion);
  }

  // ---- việc sau họp

  @Post(':id/actions')
  @Authenticated()
  addAction(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActionDto): Promise<ActionModel> {
    return this.meetings.addAction(actor, id, dto);
  }

  @Patch(':id/actions/:actionId')
  @Authenticated()
  updateAction(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: UpdateActionDto,
  ): Promise<ActionModel> {
    return this.meetings.updateAction(actor, id, actionId, dto);
  }

  @Delete(':id/actions/:actionId')
  @HttpCode(204)
  @Authenticated()
  deleteAction(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string): Promise<void> {
    return this.meetings.deleteAction(actor, id, actionId);
  }

  @Post(':id/actions/:actionId/done')
  @HttpCode(200)
  @Authenticated()
  completeAction(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string): Promise<ActionModel> {
    return this.meetings.completeAction(actor, id, actionId);
  }

  @Post(':id/actions/:actionId/reopen')
  @HttpCode(200)
  @Authenticated()
  reopenAction(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string): Promise<ActionModel> {
    return this.meetings.reopenAction(actor, id, actionId);
  }

  // ---- biên bản đính kèm

  /** Tải một tệp lên (trường `file`, tối đa 20 MB). */
  @Post(':id/attachments')
  @Authenticated()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedMulterFile | undefined) {
    if (!file) throw new BadRequestException('Chưa chọn tệp (trường file)');
    // multer đọc tên tệp theo latin1; đổi lại UTF-8 để giữ tiếng Việt.
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return this.meetings.upload(actor, id, { originalName, size: file.size, buffer: file.buffer });
  }

  @Get(':id/attachments/:attachmentId')
  @Authenticated()
  async download(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Query('inline') inline: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { attachment, data } = await this.meetings.download(actor, id, attachmentId, await this.caps(actor));
    res.set(fileResponseHeaders(attachment, data.length, inline === '1', process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000'));
    return new StreamableFile(data);
  }
}
