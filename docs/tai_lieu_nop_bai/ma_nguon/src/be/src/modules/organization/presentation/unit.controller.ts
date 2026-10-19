import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../../security/index.js';
import { UnitService } from '../application/unit.service.js';
import { CreateUnitDto, DeactivateDto, UpdateUnitDto } from './create-unit.dto.js';
import { IncludeInactiveQueryDto } from './org.dto.js';
import { definedOnly } from './org.dto.js';

@Controller('units')
export class UnitController {
  constructor(private readonly units: UnitService) {}

  @Get()
  @RequirePermission('org:read')
  list(@Query() query: IncludeInactiveQueryDto) {
    return query.includeInactive === 'true' ? this.units.list() : this.units.listActive();
  }

  @Post()
  @RequirePermission('org:manage')
  create(@Body() dto: CreateUnitDto) {
    return this.units.create({ code: dto.code, name: dto.name, type: dto.type, parentId: dto.parentId ?? null });
  }

  @Patch(':id')
  @RequirePermission('org:manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUnitDto) {
    return this.units.update(id, definedOnly(dto));
  }

  /** "Xóa" đơn vị: đổi sang INACTIVE, không xóa dòng (PLAN-A A1). */
  @Delete(':id')
  @RequirePermission('org:manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateDto) {
    return this.units.deactivate(id, dto?.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('org:manage')
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.units.reactivate(id);
  }
}
