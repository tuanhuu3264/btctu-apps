import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthorizationService, Authenticated, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import { fileResponseHeaders, MAX_FILE_BYTES } from '../../tasking/index.js';
import { ProjectService } from '../application/project.service.js';
import type { Caps, ProjectDetail, ProjectRow } from '../application/project.service.js';
import type { MilestoneModel, ProjectModel } from '../application/project.model.js';
import type { ProjectStatistics, ProjectWarnings } from '../application/project-report.js';
import type { LinkedWork } from '../application/project.ports.js';
import {
  CompleteProjectDto,
  CreateProjectDto,
  LinkWorkDto,
  MemberDto,
  MilestoneDoneDto,
  MilestoneDto,
  ProjectExportQueryDto,
  ProjectQueryDto,
  ReasonDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from './project.dto.js';

interface UploadedMulterFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/** Đề án, dự án (ADR-050). */
@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projects: ProjectService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async caps(actor: CurrentAccountModel): Promise<Caps> {
    const permissions = await this.authorization.permissionsOf(actor.id);
    return { readAll: permissions.has('project:read-all'), approve: permissions.has('project:approve') };
  }

  private filter(q: ProjectQueryDto) {
    return { status: q.status, kind: q.kind, q: q.q };
  }

  // ---- danh sách, thống kê, cảnh báo, xuất (đặt trước `:id`)

  @Get()
  @Authenticated()
  async list(@CurrentAccount() actor: CurrentAccountModel, @Query() query: ProjectQueryDto): Promise<ProjectRow[]> {
    return this.projects.list(actor, query.scope ?? 'mine', await this.caps(actor), this.filter(query));
  }

  @Get('statistics')
  @Authenticated()
  async statistics(@CurrentAccount() actor: CurrentAccountModel, @Query() query: ProjectQueryDto): Promise<ProjectStatistics> {
    return this.projects.statistics(actor, query.scope ?? 'mine', await this.caps(actor), this.filter(query));
  }

  @Get('early-warning')
  @Authenticated()
  async earlyWarning(@CurrentAccount() actor: CurrentAccountModel, @Query() query: ProjectQueryDto): Promise<ProjectWarnings> {
    return this.projects.earlyWarning(actor, query.scope ?? 'mine', await this.caps(actor));
  }

  @Get('export')
  @Authenticated()
  async export(@CurrentAccount() actor: CurrentAccountModel, @Query() query: ProjectExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.projects.exportProjects(actor, query.scope ?? 'mine', await this.caps(actor), this.filter(query), query.format);
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(file.buffer);
  }

  @Post()
  @RequirePermission('project:create')
  create(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: CreateProjectDto): Promise<ProjectModel> {
    return this.projects.create(actor, dto);
  }

  // ---- một đề án

  @Get(':id')
  @Authenticated()
  async get(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<ProjectDetail> {
    return this.projects.get(actor, id, await this.caps(actor));
  }

  @Patch(':id')
  @Authenticated()
  update(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto): Promise<ProjectModel> {
    return this.projects.update(actor, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Authenticated()
  submit(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<ProjectModel> {
    return this.projects.submit(actor, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('project:approve')
  async approve(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<ProjectModel> {
    return this.projects.approve(actor, id, await this.caps(actor));
  }

  @Post(':id/return')
  @HttpCode(200)
  @RequirePermission('project:approve')
  async sendBack(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto): Promise<ProjectModel> {
    return this.projects.sendBack(actor, id, dto.reason, await this.caps(actor));
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('project:approve')
  async complete(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteProjectDto): Promise<ProjectModel> {
    return this.projects.complete(actor, id, dto, await this.caps(actor));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Authenticated()
  async cancel(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto): Promise<ProjectModel> {
    return this.projects.cancel(actor, id, dto.reason, await this.caps(actor));
  }

  // ---- thành viên

  @Post(':id/members')
  @HttpCode(204)
  @Authenticated()
  addMember(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberDto): Promise<void> {
    return this.projects.addMember(actor, id, dto.personId);
  }

  @Delete(':id/members/:personId')
  @HttpCode(204)
  @Authenticated()
  removeMember(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Param('personId', ParseUUIDPipe) personId: string): Promise<void> {
    return this.projects.removeMember(actor, id, personId);
  }

  // ---- mốc tiến độ

  @Post(':id/milestones')
  @Authenticated()
  addMilestone(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MilestoneDto): Promise<MilestoneModel> {
    return this.projects.addMilestone(actor, id, dto);
  }

  @Patch(':id/milestones/:milestoneId')
  @Authenticated()
  updateMilestone(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ): Promise<MilestoneModel> {
    return this.projects.updateMilestone(actor, id, milestoneId, dto);
  }

  @Delete(':id/milestones/:milestoneId')
  @HttpCode(204)
  @Authenticated()
  deleteMilestone(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Param('milestoneId', ParseUUIDPipe) milestoneId: string): Promise<void> {
    return this.projects.deleteMilestone(actor, id, milestoneId);
  }

  @Post(':id/milestones/:milestoneId/done')
  @HttpCode(200)
  @Authenticated()
  completeMilestone(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: MilestoneDoneDto,
  ): Promise<MilestoneModel> {
    return this.projects.completeMilestone(actor, id, milestoneId, dto);
  }

  @Post(':id/milestones/:milestoneId/reopen')
  @HttpCode(200)
  @Authenticated()
  reopenMilestone(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Param('milestoneId', ParseUUIDPipe) milestoneId: string): Promise<MilestoneModel> {
    return this.projects.reopenMilestone(actor, id, milestoneId);
  }

  // ---- tài liệu

  /** Tải một tệp lên (trường `file`, tối đa 20 MB). */
  @Post(':id/attachments')
  @Authenticated()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedMulterFile | undefined) {
    if (!file) throw new BadRequestException('Chưa chọn tệp (trường file)');
    // multer đọc tên tệp theo latin1; đổi lại UTF-8 để giữ tiếng Việt.
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return this.projects.upload(actor, id, { originalName, size: file.size, buffer: file.buffer });
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
    const { attachment, data } = await this.projects.download(actor, id, attachmentId, await this.caps(actor));
    res.set(fileResponseHeaders(attachment, data.length, inline === '1', process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000'));
    return new StreamableFile(data);
  }

  // ---- việc được giao gắn vào đề án

  @Get(':id/link-candidates')
  @Authenticated()
  async linkCandidates(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<LinkedWork[]> {
    return this.projects.linkCandidates(actor, id, await this.caps(actor));
  }

  @Post(':id/work')
  @HttpCode(204)
  @Authenticated()
  linkWork(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkWorkDto): Promise<void> {
    return this.projects.linkWork(actor, id, dto.assignmentId);
  }

  @Delete(':id/work/:assignmentId')
  @HttpCode(204)
  @Authenticated()
  unlinkWork(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Param('assignmentId', ParseUUIDPipe) assignmentId: string): Promise<void> {
    return this.projects.unlinkWork(actor, id, assignmentId);
  }
}
