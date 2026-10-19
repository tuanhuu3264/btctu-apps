import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermission } from '../../security/index.js';
import { AssignmentService } from '../application/assignment.service.js';
import type { AssignmentModel, PersonModel, PositionModel, PublicPerson } from '../application/org.model.js';
import { toPublicPerson } from '../application/org.model.js';
import { OrgExportService } from '../application/org-export.service.js';
import { OrgQueryService } from '../application/org-query.service.js';
import type { OrgTreeUnit } from '../application/org-query.service.js';
import { PersonService } from '../application/person.service.js';
import { PositionService } from '../application/position.service.js';
import { DeactivateDto } from './create-unit.dto.js';
import {
  AssignDto,
  CreatePersonDto,
  CreatePositionDto,
  definedOnly,
  EndAssignmentDto,
  IncludeInactiveQueryDto,
  OrgExportQueryDto,
  LinkAccountDto,
  PersonQueryDto,
  PositionQueryDto,
  SubordinatesQueryDto,
  UpdatePersonDto,
  UpdatePositionDto,
} from './org.dto.js';

@Controller('persons')
export class PersonController {
  constructor(private readonly persons: PersonService) {}

  @Get()
  @RequirePermission('org:read')
  async list(@Query() query: PersonQueryDto): Promise<PublicPerson[]> {
    return (await this.persons.list(definedOnly(query))).map(toPublicPerson);
  }

  @Post()
  @RequirePermission('org:manage')
  create(@Body() dto: CreatePersonDto): Promise<PersonModel> {
    return this.persons.create({ ...definedOnly(dto), fullName: dto.fullName, note: dto.note ?? null });
  }

  @Get(':id')
  @RequirePermission('org:read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<PublicPerson> {
    return toPublicPerson(await this.persons.get(id));
  }

  /** Hồ sơ đầy đủ kèm trường nhạy cảm (ngày sinh, CCCD, email, điện thoại): chỉ người quản lý tổ chức. */
  @Get(':id/profile')
  @RequirePermission('org:manage')
  profile(@Param('id', ParseUUIDPipe) id: string): Promise<PersonModel> {
    return this.persons.get(id);
  }

  @Patch(':id')
  @RequirePermission('org:manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePersonDto): Promise<PersonModel> {
    return this.persons.update(id, definedOnly(dto));
  }

  @Post(':id/deactivate')
  @HttpCode(204)
  @RequirePermission('org:manage')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.persons.deactivate(id);
  }

  @Get(':id/assignments')
  @RequirePermission('org:read')
  history(@Param('id', ParseUUIDPipe) id: string): Promise<AssignmentModel[]> {
    return this.persons.history(id);
  }

  @Put(':id/account')
  @HttpCode(204)
  @RequirePermission('account:link-person')
  linkAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkAccountDto): Promise<void> {
    return this.persons.linkAccount(id, dto.accountId);
  }

  @Delete(':id/account')
  @HttpCode(204)
  @RequirePermission('account:link-person')
  unlinkAccount(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.persons.unlinkAccount(id);
  }
}

@Controller('positions')
export class PositionController {
  constructor(
    private readonly positions: PositionService,
    private readonly assignments: AssignmentService,
  ) {}

  @Get()
  @RequirePermission('org:read')
  list(@Query() query: PositionQueryDto): Promise<PositionModel[]> {
    const { includeInactive, ...filter } = definedOnly(query);
    return includeInactive === 'true' ? this.positions.list(filter) : this.positions.listActive(filter);
  }

  @Post()
  @RequirePermission('org:manage')
  create(@Body() dto: CreatePositionDto): Promise<PositionModel> {
    return this.positions.create({
      code: dto.code,
      unitId: dto.unitId,
      title: dto.title,
      level: dto.level,
      ...(dto.isLeader === undefined ? {} : { isLeader: dto.isLeader }),
      ...(dto.isSupport === undefined ? {} : { isSupport: dto.isSupport }),
      reportsToPositionId: dto.reportsToPositionId ?? null,
      duties: dto.duties ?? null,
      referenceOkr: dto.referenceOkr ?? null,
    });
  }

  @Get(':id')
  @RequirePermission('org:read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PositionModel> {
    return this.positions.get(id);
  }

  @Patch(':id')
  @RequirePermission('org:manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePositionDto): Promise<PositionModel> {
    return this.positions.update(id, definedOnly(dto));
  }

  /** "Xóa" vị trí: đổi sang INACTIVE, không xóa dòng (PLAN-A A1). */
  @Delete(':id')
  @RequirePermission('org:manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateDto): Promise<PositionModel> {
    return this.positions.deactivate(id, dto?.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('org:manage')
  reactivate(@Param('id', ParseUUIDPipe) id: string): Promise<PositionModel> {
    return this.positions.reactivate(id);
  }

  @Get(':id/subordinates')
  @RequirePermission('org:read')
  subordinates(@Param('id', ParseUUIDPipe) id: string, @Query() query: SubordinatesQueryDto): Promise<PositionModel[]> {
    return this.positions.subordinates(id, { direct: query.direct === 'true' });
  }

  @Get(':id/chain')
  @RequirePermission('org:read')
  chain(@Param('id', ParseUUIDPipe) id: string): Promise<PositionModel[]> {
    return this.positions.chain(id);
  }

  @Post(':id/assignments')
  @RequirePermission('org:manage')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto): Promise<AssignmentModel> {
    return this.assignments.assign(id, dto.personId, dto.validFrom ? new Date(dto.validFrom) : undefined, dto.kind);
  }
}

@Controller('assignments')
export class AssignmentController {
  constructor(private readonly assignments: AssignmentService) {}

  @Post(':id/end')
  @HttpCode(204)
  @RequirePermission('org:manage')
  end(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EndAssignmentDto): Promise<void> {
    return this.assignments.end(id, dto.validTo ? new Date(dto.validTo) : undefined);
  }
}

@Controller('org')
export class OrgController {
  constructor(
    private readonly query: OrgQueryService,
    private readonly exporter: OrgExportService,
  ) {}

  @Get('tree')
  @RequirePermission('org:read')
  tree(@Query() query: IncludeInactiveQueryDto): Promise<OrgTreeUnit[]> {
    return this.query.tree({ includeInactive: query.includeInactive === 'true' });
  }

  /** Xuất danh sách đơn vị, vị trí hoặc cán bộ ra Excel hoặc PDF (không gồm dữ liệu cá nhân nhạy cảm). */
  @Get('export')
  @RequirePermission('org:read')
  async export(@Query() query: OrgExportQueryDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.exporter.export(query.list, query.format, query.includeInactive === 'true');
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(file.buffer);
  }
}
