import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { AuthorizationService, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import type { Draft } from '../application/draft-templates.js';
import type { PeriodReport, Trend, UnitReport } from '../application/report.model.js';
import { ReportService } from '../application/report.service.js';
import type { ExportFormat } from '../application/report.service.js';

class ExportQueryDto {
  @IsIn(['xlsx', 'pdf'])
  format: ExportFormat;
}

class DraftQueryDto {
  @IsIn(['report', 'decision', 'notice'])
  kind: 'report' | 'decision' | 'notice';
}

const DRAFT_KIND = { report: 'REPORT', decision: 'DECISION', notice: 'NOTICE' } as const;

class TrendQueryDto {
  @IsIn(['MONTH', 'QUARTER', 'YEAR'])
  type: 'MONTH' | 'QUARTER' | 'YEAR';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(12)
  limit?: number;
}

@Controller('reporting')
export class ReportController {
  constructor(
    private readonly reports: ReportService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Có quyền xem toàn bộ hồ sơ đánh giá không (Văn phòng, Trưởng ban). */
  private async canReadAll(actor: CurrentAccountModel): Promise<boolean> {
    return (await this.authorization.permissionsOf(actor.id)).has('evaluation:read-all');
  }

  /** Dashboard: tổng hợp số liệu của một kỳ trong phạm vi người xem được. */
  @Get('periods/:id/dashboard')
  @RequirePermission('report:read')
  async dashboard(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string): Promise<PeriodReport> {
    return this.reports.periodReport(actor, periodId, await this.canReadAll(actor));
  }

  /** Xu hướng qua các kỳ cùng loại (mặc định 8 kỳ gần nhất). */
  @Get('trend')
  @RequirePermission('report:read')
  async trend(@CurrentAccount() actor: CurrentAccountModel, @Query() query: TrendQueryDto): Promise<Trend> {
    return this.reports.trend(actor, query.type, query.limit ?? 8, await this.canReadAll(actor));
  }

  @Get('periods/:id/export')
  @RequirePermission('report:export')
  async export(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) periodId: string,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.reports.export(actor, periodId, query.format, await this.canReadAll(actor));
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.buffer);
  }

  /** Tải dự thảo thành tệp Word (.docx) để người có thẩm quyền chỉnh sửa. */
  @Get('periods/:id/draft/file')
  @RequirePermission('report:draft')
  async draftFile(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) periodId: string,
    @Query() query: DraftQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.reports.exportDraft(actor, periodId, DRAFT_KIND[query.kind], await this.canReadAll(actor));
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(file.buffer);
  }

  /** Dự thảo báo cáo hoặc quyết định điền mẫu (không dùng AI), chỉ để tham khảo. */
  @Get('periods/:id/draft')
  @RequirePermission('report:draft')
  async draft(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) periodId: string,
    @Query() query: DraftQueryDto,
  ): Promise<Draft> {
    return this.reports.draft(actor, periodId, DRAFT_KIND[query.kind], await this.canReadAll(actor));
  }

  // ---- tập thể (ADR-031)

  @Get('periods/:id/units')
  @RequirePermission('report:read')
  async unitReport(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string): Promise<UnitReport> {
    return this.reports.unitReport(actor, periodId, await this.canReadAll(actor));
  }

  @Get('periods/:id/units/export')
  @RequirePermission('report:export')
  async exportUnits(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.reports.exportUnits(actor, periodId, await this.canReadAll(actor));
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(file.buffer);
  }

  @Get('periods/:id/units/draft/file')
  @RequirePermission('report:draft')
  async unitDraftFile(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.reports.exportUnitDraft(actor, periodId, await this.canReadAll(actor));
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(file.buffer);
  }

  @Get('periods/:id/units/draft')
  @RequirePermission('report:draft')
  async unitDraft(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string): Promise<Draft> {
    return this.reports.unitDraft(actor, periodId, await this.canReadAll(actor));
  }
}
