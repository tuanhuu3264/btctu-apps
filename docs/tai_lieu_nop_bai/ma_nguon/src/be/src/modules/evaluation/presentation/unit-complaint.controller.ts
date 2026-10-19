import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthorizationService, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import { UnitComplaintService } from '../application/unit-complaint.service.js';
import type { ComplaintAccess } from '../application/unit-complaint.service.js';
import type { UnitComplaintModel } from '../application/unit-complaint.js';
import { CloseComplaintDto, CreateComplaintDto, DirectVerificationDto } from './evaluation.dto.js';

/**
 * Khiếu nại, phản ánh về tập thể (ADR-038). Văn phòng ghi nhận (`complaint:manage`); chỉ đạo xác minh và kết luận do
 * người có thẩm quyền công nhận hồ sơ, kiểm ở lớp nghiệp vụ. Nội dung nhạy cảm nên mọi đường dẫn đều cần đăng nhập và quyền xem hồ sơ.
 */
@Controller('unit-complaint')
export class UnitComplaintController {
  constructor(
    private readonly complaints: UnitComplaintService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async access(actor: CurrentAccountModel): Promise<ComplaintAccess> {
    const permissions = await this.authorization.permissionsOf(actor.id);
    return { readAll: permissions.has('evaluation:read-all'), decideBan: permissions.has('evaluation:decide-ban'), manage: permissions.has('complaint:manage') };
  }

  @Get('evaluation/:evaluationId')
  @RequirePermission('evaluation:read')
  async list(@CurrentAccount() actor: CurrentAccountModel, @Param('evaluationId', ParseUUIDPipe) evaluationId: string): Promise<UnitComplaintModel[]> {
    return this.complaints.list(actor, evaluationId, await this.access(actor));
  }

  @Post('evaluation/:evaluationId')
  @RequirePermission('complaint:manage')
  async create(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('evaluationId', ParseUUIDPipe) evaluationId: string,
    @Body() dto: CreateComplaintDto,
  ): Promise<UnitComplaintModel> {
    return this.complaints.create(actor, evaluationId, dto, await this.access(actor));
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('evaluation:approve')
  async direct(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DirectVerificationDto): Promise<UnitComplaintModel> {
    return this.complaints.direct(actor, id, dto, await this.access(actor));
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('evaluation:approve')
  async close(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseComplaintDto): Promise<UnitComplaintModel> {
    return this.complaints.close(actor, id, dto, await this.access(actor));
  }
}
