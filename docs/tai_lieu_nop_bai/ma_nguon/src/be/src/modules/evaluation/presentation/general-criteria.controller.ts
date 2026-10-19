import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import { GeneralCriteriaService } from '../application/general-criteria.service.js';
import type { GeneralCriteriaVersionView } from '../application/general-criteria.service.js';
import type { GeneralCriteriaVersion } from '../application/general-criteria.js';
import { CreateGeneralCriteriaDto } from './evaluation.dto.js';

/** Bảng tiêu chí chung 30 điểm của cá nhân theo phiên bản (ADR-054). */
@Controller('evaluation/general-criteria')
export class GeneralCriteriaController {
  constructor(private readonly criteria: GeneralCriteriaService) {}

  @Get()
  @RequirePermission('evaluation:read')
  list(): Promise<GeneralCriteriaVersionView[]> {
    return this.criteria.list();
  }

  /** Văn phòng thêm phiên bản, áp dụng từ tháng chưa có ai tự chấm. */
  @Post()
  @RequirePermission('evaluation:period-manage')
  create(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: CreateGeneralCriteriaDto): Promise<GeneralCriteriaVersion> {
    return this.criteria.create(actor, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('evaluation:period-manage')
  remove(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.criteria.remove(actor, id);
  }
}
