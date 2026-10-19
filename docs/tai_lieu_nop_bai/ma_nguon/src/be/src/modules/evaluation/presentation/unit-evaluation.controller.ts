import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AuthorizationService, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import type { UnitEvaluationModel } from '../application/unit-evaluation.model.js';
import { UnitEvaluationService } from '../application/unit-evaluation.service.js';
import type { AxisSetView, GenerateUnitsResult, UnitAccess, UnitEvaluationView } from '../application/unit-evaluation.service.js';
import type { AxisDefinition } from '../application/unit-axes.js';
import { ApproveEvaluationDto, ReplaceAxesDto, ReturnDto, UnitScoreDto } from './evaluation.dto.js';

/** Đánh giá, xếp loại tập thể theo năm (ADR-030). Quyền vai trò kiểm ở đây; phạm vi và trạng thái kiểm ở lớp nghiệp vụ. */
@Controller('unit-evaluation')
export class UnitEvaluationController {
  constructor(
    private readonly units: UnitEvaluationService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async access(actor: CurrentAccountModel): Promise<UnitAccess> {
    const permissions = await this.authorization.permissionsOf(actor.id);
    return { readAll: permissions.has('evaluation:read-all'), decideBan: permissions.has('evaluation:decide-ban') };
  }

  /** Văn phòng tạo hồ sơ cho mọi đơn vị trong kỳ năm. */
  @Post('periods/:id/generate')
  @HttpCode(200)
  @RequirePermission('evaluation:period-manage')
  generate(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string): Promise<GenerateUnitsResult> {
    return this.units.generate(actor, periodId);
  }

  /**
   * Các trục chấm điểm tập thể (ADR-036): bộ mặc định, hoặc bộ đang áp dụng cho đơn vị `unitId` (ADR-052). Đặt trước các
   * đường dẫn có mã để không bị coi là mã hồ sơ.
   */
  @Get('axes')
  @RequirePermission('evaluation:read')
  axes(@Query('unitId', new ParseUUIDPipe({ optional: true })) unitId?: string): Promise<AxisDefinition[]> {
    return this.units.axes(unitId ?? null);
  }

  /** Bộ mặc định và bộ đang áp dụng cho từng đơn vị. */
  @Get('axis-sets')
  @RequirePermission('evaluation:read')
  axisSets(): Promise<AxisSetView[]> {
    return this.units.axisSets();
  }

  /** Văn phòng thay một bộ trục (bộ mặc định khi không có `unitId`): tổng điểm tối đa mỗi nhóm đang bật phải đúng 30 hoặc 70. */
  @Put('axes')
  @RequirePermission('evaluation:period-manage')
  replaceAxes(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: ReplaceAxesDto): Promise<AxisDefinition[]> {
    return this.units.replaceAxes(
      actor,
      dto.axes.map((a) => ({ ...a, autoMetric: a.autoMetric ?? null })),
      dto.unitId ?? null,
    );
  }

  /** Văn phòng bỏ bộ trục riêng của đơn vị; trả về bộ mặc định mà đơn vị sẽ dùng. */
  @Delete('axes/:unitId')
  @RequirePermission('evaluation:period-manage')
  resetAxes(@CurrentAccount() actor: CurrentAccountModel, @Param('unitId', ParseUUIDPipe) unitId: string): Promise<AxisDefinition[]> {
    return this.units.resetAxes(actor, unitId);
  }

  @Get('periods/:id')
  @RequirePermission('evaluation:read')
  async list(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string): Promise<UnitEvaluationView[]> {
    return this.units.list(actor, periodId, await this.access(actor));
  }

  @Get(':id')
  @RequirePermission('evaluation:read')
  async get(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<UnitEvaluationView> {
    return this.units.get(actor, id, await this.access(actor));
  }

  /** Người đứng đầu đơn vị tự đánh giá và đề xuất điểm. */
  @Post(':id/self-submit')
  @RequirePermission('evaluation:self')
  selfSubmit(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnitScoreDto): Promise<UnitEvaluationModel> {
    return this.units.selfSubmit(actor, id, dto);
  }

  @Post(':id/review')
  @RequirePermission('evaluation:review')
  async review(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnitScoreDto): Promise<UnitEvaluationView> {
    return this.units.review(actor, id, dto, await this.access(actor));
  }

  @Post(':id/return')
  @RequirePermission('evaluation:review')
  async returnEvaluation(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnDto): Promise<UnitEvaluationModel> {
    return this.units.returnEvaluation(actor, id, dto.reason, await this.access(actor));
  }

  /** Công nhận kết quả. Từ đây hồ sơ khóa. */
  @Post(':id/approve')
  @RequirePermission('evaluation:approve')
  async approve(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveEvaluationDto): Promise<UnitEvaluationView> {
    return this.units.approve(actor, id, dto.comment, await this.access(actor));
  }
}
