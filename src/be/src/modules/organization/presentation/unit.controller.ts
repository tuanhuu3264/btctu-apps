import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '../../security/index.js';
import { UnitService } from '../application/unit.service.js';
import { CreateUnitDto, UpdateUnitDto } from './create-unit.dto.js';
import { definedOnly } from './org.dto.js';

@Controller('units')
export class UnitController {
  constructor(private readonly units: UnitService) {}

  @Get()
  @RequirePermission('org:read')
  list() {
    return this.units.list();
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

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('org:manage')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.units.delete(id);
  }
}
