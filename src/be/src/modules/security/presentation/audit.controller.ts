import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from '../application/audit.service.js';
import type { AuditRecord, AuditVerification } from '../application/audit.model.js';
import { AuditQueryDto } from './audit.dto.js';
import { RequirePermission } from './require-permission.decorator.js';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  async list(@Query() query: AuditQueryDto): Promise<AuditRecord[]> {
    const rows = await this.audit.find(query);
    // Việc đọc nhật ký cũng được ghi lại.
    await this.audit.record({
      action: 'audit.read',
      outcome: 'SUCCESS',
      details: { action: query.action, actorId: query.actorId, beforeId: query.beforeId, returned: rows.length },
    });
    return rows;
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
