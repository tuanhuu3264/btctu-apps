import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  AssignmentModel,
  NewAssignment,
  NewPerson,
  NewPosition,
  PersonModel,
  PersonPatch,
  PositionModel,
  PositionPatch,
} from '../application/org.model.js';
import type { InactiveInfo } from '../application/unit.model.js';
import { defaultIsLeader, EMPTY_PROFILE, PERSON_PROFILE_FIELDS } from '../application/org.model.js';
import { AssignmentRepository, PersonRepository, PositionRepository } from '../application/org.ports.js';
import { AssignmentEntity, JobPositionEntity, PersonEntity } from './org.entities.js';

@Injectable()
export class TypeOrmPersonRepository extends PersonRepository {
  constructor(@InjectRepository(PersonEntity) private readonly repo: Repository<PersonEntity>) {
    super();
  }

  async findById(id: string): Promise<PersonModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toPerson(row) : null;
  }

  async findAll(filter?: { active?: boolean }): Promise<PersonModel[]> {
    const where = filter?.active === undefined ? {} : { active: filter.active };
    return (await this.repo.find({ where, order: { fullName: 'ASC' } })).map(toPerson);
  }

  async findByFullName(fullName: string): Promise<PersonModel[]> {
    return (await this.repo.find({ where: { fullName } })).map(toPerson);
  }

  async findByEmployeeCode(code: string): Promise<PersonModel | null> {
    const row = await this.repo.createQueryBuilder('p').where('upper(p.employee_code) = upper(:code)', { code }).getOne();
    return row ? toPerson(row) : null;
  }

  async findByNationalId(nationalId: string): Promise<PersonModel | null> {
    const row = await this.repo.findOneBy({ nationalId });
    return row ? toPerson(row) : null;
  }

  async create(data: NewPerson): Promise<PersonModel> {
    return toPerson(await this.repo.save(this.repo.create({ ...EMPTY_PROFILE, ...data })));
  }

  async update(id: string, patch: PersonPatch): Promise<PersonModel> {
    await this.repo.update({ id }, patch);
    return toPerson(await this.repo.findOneByOrFail({ id }));
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.repo.update({ id }, { active });
  }
}

@Injectable()
export class TypeOrmPositionRepository extends PositionRepository {
  constructor(@InjectRepository(JobPositionEntity) private readonly repo: Repository<JobPositionEntity>) {
    super();
  }

  async findById(id: string): Promise<PositionModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toPosition(row) : null;
  }

  async findByCode(code: string): Promise<PositionModel | null> {
    const row = await this.repo.findOneBy({ code });
    return row ? toPosition(row) : null;
  }

  async findAll(filter?: { unitId?: string }): Promise<PositionModel[]> {
    const where = filter?.unitId ? { unitId: filter.unitId } : {};
    return (await this.repo.find({ where, order: { level: 'ASC', code: 'ASC' } })).map(toPosition);
  }

  async create(data: NewPosition): Promise<PositionModel> {
    return toPosition(await this.repo.save(this.repo.create({ ...data, isLeader: data.isLeader ?? defaultIsLeader(data.level), status: 'ACTIVE', inactiveAt: null, inactiveReason: null })));
  }

  async update(id: string, patch: PositionPatch): Promise<PositionModel> {
    await this.repo.update({ id }, patch);
    return toPosition(await this.repo.findOneByOrFail({ id }));
  }

  async setStatus(id: string, info: InactiveInfo): Promise<PositionModel> {
    await this.repo.update({ id }, info);
    return toPosition(await this.repo.findOneByOrFail({ id }));
  }
}

@Injectable()
export class TypeOrmAssignmentRepository extends AssignmentRepository {
  constructor(@InjectRepository(AssignmentEntity) private readonly repo: Repository<AssignmentEntity>) {
    super();
  }

  async findById(id: string): Promise<AssignmentModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toAssignment(row) : null;
  }

  async findAll(): Promise<AssignmentModel[]> {
    return (await this.repo.find({ order: { validFrom: 'ASC' } })).map(toAssignment);
  }

  async findByPerson(personId: string): Promise<AssignmentModel[]> {
    return (await this.repo.find({ where: { personId }, order: { validFrom: 'ASC' } })).map(toAssignment);
  }

  async findByPosition(positionId: string): Promise<AssignmentModel[]> {
    return (await this.repo.find({ where: { positionId }, order: { validFrom: 'ASC' } })).map(toAssignment);
  }

  async create(data: NewAssignment): Promise<AssignmentModel> {
    return toAssignment(await this.repo.save(this.repo.create(data)));
  }

  async end(id: string, at: Date): Promise<void> {
    await this.repo.update({ id }, { validTo: at });
  }
}

const toPerson = (e: PersonEntity): PersonModel => ({
  id: e.id,
  fullName: e.fullName,
  note: e.note,
  active: e.active,
  ...(Object.fromEntries(PERSON_PROFILE_FIELDS.map((f) => [f, e[f] ?? null])) as unknown as typeof EMPTY_PROFILE),
});

const toPosition = (e: JobPositionEntity): PositionModel => ({
  id: e.id,
  code: e.code,
  unitId: e.unitId,
  title: e.title,
  level: e.level,
  isLeader: e.isLeader,
  reportsToPositionId: e.reportsToPositionId,
  duties: e.duties,
  referenceOkr: e.referenceOkr,
  status: e.status,
  inactiveAt: e.inactiveAt,
  inactiveReason: e.inactiveReason,
});

const toAssignment = (e: AssignmentEntity): AssignmentModel => ({
  id: e.id,
  personId: e.personId,
  positionId: e.positionId,
  kind: e.kind,
  validFrom: e.validFrom,
  validTo: e.validTo,
});
