import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../../security/index.js';
import { AssignmentService } from '../application/assignment.service.js';
import type { AssignmentModel, PersonModel, PositionModel, PublicPerson } from '../application/org.model.js';
import { toPublicPerson } from '../application/org.model.js';
import { OrgQueryService } from '../application/org-query.service.js';
import type { OrgTreeUnit } from '../application/org-query.service.js';
import { PersonService } from '../application/person.service.js';
import { PositionService } from '../application/position.service.js';
import {
  AssignDto,
  CreatePersonDto,
  CreatePositionDto,
  definedOnly,
  EndAssignmentDto,
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
    return this.positions.list(definedOnly(query));
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

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('org:manage')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.positions.delete(id);
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
    return this.assignments.assign(id, dto.personId, dto.validFrom ? new Date(dto.validFrom) : undefined);
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
  constructor(private readonly query: OrgQueryService) {}

  @Get('tree')
  @RequirePermission('org:read')
  tree(): Promise<OrgTreeUnit[]> {
    return this.query.tree();
  }
}
