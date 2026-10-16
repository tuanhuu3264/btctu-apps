import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from '../application/audit.service.js';
import type { AuditRecord, AuditVerification } from '../application/audit.model.js';
import { AUDIT_MODULES, AUDIT_TYPES } from '../application/audit-classify.js';
import { AuditExportQueryDto, AuditQueryDto, EntityHistoryQueryDto } from './audit.dto.js';
import { RequirePermission } from './require-permission.decorator.js';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  async list(@Query() query: AuditQueryDto): Promise<AuditRecord[]> {
    const { from, to, ...rest } = query;
    const rows = await this.audit.find({ ...rest, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
    // Việc đọc nhật ký cũng được ghi lại.
    await this.audit.record({
      action: 'audit.read',
      outcome: 'SUCCESS',
      details: { action: query.action, actorId: query.actorId, username: query.username, outcome: query.outcome, module: query.module, type: query.type, targetType: query.targetType, targetId: query.targetId, from, to, beforeId: query.beforeId, returned: rows.length },
    });
    return rows;
  }

  /** Xuất nhật ký theo bộ lọc ra Excel hoặc PDF (không gồm cột chi tiết). Việc xuất cũng được ghi lại. */
  @Get('export')
  @RequirePermission('audit:read')
  async export(@Query() query: AuditExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { format, from, to, beforeId: _beforeId, limit: _limit, ...rest } = query;
    const file = await this.audit.exportTable({ ...rest, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }, format);
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(file.buffer);
  }

  /** Lịch sử thay đổi của một đối tượng (ví dụ `unit`, `position`, `person`), mới nhất trước. */
  @Get('entity/:targetType/:targetId')
  @RequirePermission('audit:read')
  async history(
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
    @Query() query: EntityHistoryQueryDto,
  ): Promise<AuditRecord[]> {
    const rows = await this.audit.historyOf(targetType, targetId, query);
    await this.audit.record({ action: 'audit.read', outcome: 'SUCCESS', details: { targetType, targetId, beforeId: query.beforeId, returned: rows.length } });
    return rows;
  }

  /** Các giá trị `module` và `type` có thể lọc. */
  @Get('facets')
  @RequirePermission('audit:read')
  facets(): { modules: readonly string[]; types: readonly string[] } {
    return { modules: AUDIT_MODULES, types: AUDIT_TYPES };
  }

  /** Các hành động đã từng được ghi, dùng làm bộ lọc ở giao diện. */
  @Get('actions')
  @RequirePermission('audit:read')
  actions(): Promise<string[]> {
    return this.audit.actions();
  }

  /** Kiểm tra toàn vẹn chuỗi băm của nhật ký. */
  @Get('verify')
  @RequirePermission('audit:read')
  async verify(): Promise<AuditVerification> {
    const result = await this.audit.verify();
    await this.audit.record({
      action: 'audit.verify',
      outcome: result.valid ? 'SUCCESS' : 'FAILURE',
      details: { checked: result.checked, valid: result.valid, firstInvalidId: result.firstInvalidId },
    });
    return result;
  }
}
