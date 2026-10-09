import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthorizationService, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import { CollaborationService } from '../application/collaboration.service.js';
import type { Conversation, FileSearchResult } from '../application/collaboration.service.js';
import { fileResponseHeaders } from '../application/file-rules.js';
import { MAX_FILE_BYTES } from '../application/tasking.model.js';
import type { AssignmentModel, AttachmentModel, CommentModel, ProgressModel, WorkTaskModel } from '../application/tasking.model.js';

/** Tệp đính kèm trả cho trình duyệt: không lộ khóa lưu trữ nội bộ. */
type PublicAttachment = Omit<AttachmentModel, 'storageKey'>;
const toPublicAttachment = ({ storageKey: _storageKey, ...rest }: AttachmentModel): PublicAttachment => rest;
import { TaskingService } from '../application/tasking.service.js';
import type { AssignmentView, SearchResult } from '../application/tasking.service.js';
import { AssignDto, CommentDto, CreateTaskDto, DecisionDto, FileSearchQueryDto, ListQueryDto, ReportDto, SearchQueryDto, UpdateAssignmentDto, UploadDto } from './tasking.dto.js';

/** Phần của tệp do multer đọc (lưu trong bộ nhớ) mà controller dùng. */
interface UploadedMulterFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Controller('tasking')
export class TaskingController {
  constructor(
    private readonly tasking: TaskingService,
    private readonly collaboration: CollaborationService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Có quyền xem toàn bộ việc (Văn phòng, Trưởng ban), ngoài phạm vi theo cây vị trí. */
  private async canReadAll(actor: CurrentAccountModel): Promise<boolean> {
    return (await this.authorization.permissionsOf(actor.id)).has('task:read-all');
  }

  /** Nhiệm vụ theo cùng phạm vi `scope` với danh sách việc (ADR-018). */
  @Get('tasks')
  @RequirePermission('task:read')
  async listTasks(@CurrentAccount() actor: CurrentAccountModel, @Query() query: ListQueryDto): Promise<WorkTaskModel[]> {
    return this.tasking.listTasks(actor, query.scope ?? 'mine', await this.canReadAll(actor));
  }

  /** Cấp trên trực tiếp tạo nhiệm vụ cho cán bộ; công việc từ danh mục được giao vào nhiệm vụ này. */
  @Post('tasks')
  @RequirePermission('task:assign')
  createTask(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: CreateTaskDto): Promise<WorkTaskModel> {
    return this.tasking.createTask(actor, dto);
  }

  /** `scope`: mine (việc của mình, mặc định), team (việc của cấp dưới), all (toàn bộ, cần quyền xem toàn bộ). */
  @Get('assignments')
  @RequirePermission('task:read')
  async list(@CurrentAccount() actor: CurrentAccountModel, @Query() query: ListQueryDto): Promise<AssignmentView[]> {
    return this.tasking.list(actor, query.scope ?? 'mine', await this.canReadAll(actor));
  }

  /**
   * Theo dõi việc có lọc và phân trang (ADR-024). `scope`: mine, team, all, consulted (được tham vấn), approving (chờ tôi duyệt),
   * assigned (tôi đã giao). Đặt trước `assignments/:id` để "search" không bị hiểu là mã.
   */
  @Get('assignments/search')
  @RequirePermission('task:read')
  async search(@CurrentAccount() actor: CurrentAccountModel, @Query() query: SearchQueryDto): Promise<SearchResult> {
    return this.tasking.search(actor, { ...query, scope: query.scope ?? 'mine' }, await this.canReadAll(actor));
  }

  /** Tệp của các việc mà người dùng là thành viên, có lọc và phân trang (ADR-025 mục 1). Đặt trước `assignments/:id`. */
  @Get('files')
  @RequirePermission('task:read')
  async searchFiles(@CurrentAccount() actor: CurrentAccountModel, @Query() query: FileSearchQueryDto): Promise<FileSearchResult> {
    return this.collaboration.searchFiles(actor, query, await this.canReadAll(actor));
  }

  @Post('assignments')
  @RequirePermission('task:assign')
  assign(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: AssignDto): Promise<AssignmentView> {
    return this.tasking.assign(actor, dto);
  }

  @Get('assignments/:id')
  @RequirePermission('task:read')
  async get(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<AssignmentView> {
    return this.tasking.get(actor, id, await this.canReadAll(actor));
  }

  /** Người giao sửa nội dung, người duyệt (cc) và người tham vấn của việc còn mở. */
  @Patch('assignments/:id')
  @RequirePermission('task:assign')
  update(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssignmentDto): Promise<AssignmentView> {
    return this.tasking.update(actor, id, dto);
  }

  /** Trao đổi và tệp của việc; chỉ thành viên (và người xem toàn bộ, chỉ đọc). */
  @Get('assignments/:id/conversation')
  @RequirePermission('task:read')
  async conversation(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ comments: Conversation['comments']; attachments: PublicAttachment[] }> {
    const { comments, attachments } = await this.collaboration.conversation(actor, id, await this.canReadAll(actor));
    return { comments, attachments: attachments.map(toPublicAttachment) };
  }

  @Post('assignments/:id/comments')
  @RequirePermission('task:read')
  addComment(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto): Promise<CommentModel> {
    return this.collaboration.addComment(actor, id, dto);
  }

  /** Tải một tệp lên (trường `file`, tối đa 20 MB); `commentId` để gắn vào tin nhắn của chính mình. */
  @Post('assignments/:id/attachments')
  @RequirePermission('task:read')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async upload(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body() dto: UploadDto,
  ): Promise<PublicAttachment> {
    if (!file) throw new BadRequestException('Chưa chọn tệp (trường file)');
    // multer đọc tên tệp theo latin1; đổi lại UTF-8 để giữ tiếng Việt.
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return toPublicAttachment(await this.collaboration.upload(actor, id, { originalName, size: file.size, buffer: file.buffer }, dto.commentId));
  }

  /** Tải tệp về qua máy chủ (không công khai), mặc định là tệp đính kèm; `?inline=1` để xem trực tiếp pdf, ảnh, văn bản (ADR-026). */
  @Get('assignments/:id/attachments/:attachmentId')
  @RequirePermission('task:read')
  async download(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Query('inline') inline: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { attachment, data } = await this.collaboration.download(actor, id, attachmentId, await this.canReadAll(actor));
    res.set(fileResponseHeaders(attachment, data.length, inline === '1', process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000'));
    return new StreamableFile(data);
  }

  @Post('assignments/:id/cancel')
  @RequirePermission('task:assign')
  cancel(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<AssignmentModel> {
    return this.tasking.cancel(actor, id);
  }

  /** Cán bộ báo cáo đã hoàn thành; chờ cấp trên xác nhận mới được tính. */
  @Post('assignments/:id/progress')
  @RequirePermission('task:report')
  report(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportDto): Promise<ProgressModel> {
    return this.tasking.report(actor, id, dto);
  }

  /** Cấp trên trực tiếp xác nhận hoặc từ chối (kèm lý do) một lần báo cáo. */
  @Post('progress/:id/decision')
  @RequirePermission('task:confirm')
  decide(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto): Promise<ProgressModel> {
    return this.tasking.decide(actor, id, dto);
  }
}
