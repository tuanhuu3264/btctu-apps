import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AccountService, AuditService } from '../../security/index.js';
import { EMPTY_PROFILE, isCurrent, PERSON_PROFILE_FIELDS, SENSITIVE_PERSON_FIELDS } from './org.model.js';
import type { AssignmentModel, NewPerson, PersonModel, PersonPatch } from './org.model.js';
import { AssignmentRepository, PersonRepository } from './org.ports.js';

@Injectable()
export class PersonService {
  constructor(
    private readonly persons: PersonRepository,
    private readonly assignments: AssignmentRepository,
    private readonly accounts: AccountService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  list(filter?: { active?: boolean }): Promise<PersonModel[]> {
    return this.persons.findAll(filter);
  }

  async get(id: string): Promise<PersonModel> {
    const person = await this.persons.findById(id);
    if (!person) throw new NotFoundException(`Không tìm thấy cán bộ: ${id}`);
    return person;
  }

  findByFullName(fullName: string): Promise<PersonModel[]> {
    return this.persons.findByFullName(fullName);
  }

  async create(input: NewPerson): Promise<PersonModel> {
    const fullName = normalizeName(input.fullName);
    if (fullName.length < 2) throw new BadRequestException('Họ tên quá ngắn');
    const profile = await this.cleanProfile(input, null);
    const created = await this.persons.create({ ...EMPTY_PROFILE, ...profile, fullName, note: input.note });
    await this.audit.record({
      action: 'person.create',
      outcome: 'SUCCESS',
      targetType: 'person',
      targetId: created.id,
      details: { fullName: created.fullName, employeeCode: created.employeeCode },
    });
    return created;
  }

  async update(id: string, patch: PersonPatch): Promise<PersonModel> {
    const current = await this.get(id);
    const clean: PersonPatch = { ...patch };
    if (clean.fullName !== undefined) {
      clean.fullName = normalizeName(clean.fullName);
      if (clean.fullName.length < 2) throw new BadRequestException('Họ tên quá ngắn');
    }
    Object.assign(clean, await this.cleanProfile(patch, current));
    const updated = await this.persons.update(id, clean);
    // Nhật ký chỉ ghi tên trường đã đổi, không ghi giá trị của trường nhạy cảm.
    await this.audit.record({
      action: 'person.update',
      outcome: 'SUCCESS',
      targetType: 'person',
      targetId: id,
      details: {
        changed: Object.keys(clean),
        sensitiveChanged: SENSITIVE_PERSON_FIELDS.filter((f) => f in clean),
        previousFullName: current.fullName,
      },
    });
    return updated;
  }

  /**
   * Chuẩn hóa các trường hồ sơ có trong `input` (chuỗi rỗng thành null) và kiểm tra: mã cán bộ, số CCCD không trùng người khác;
   * ngày không ở tương lai; ngày vào cơ quan, vào Đảng không trước ngày sinh.
   */
  private async cleanProfile(input: Record<string, unknown>, current: PersonModel | null): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const f of PERSON_PROFILE_FIELDS) {
      if (!(f in input) || input[f] === undefined) continue;
      const v = input[f];
      out[f] = typeof v === 'string' ? v.trim() || null : v;
    }
    if (typeof out.employeeCode === 'string') out.employeeCode = out.employeeCode.toUpperCase();
    if (typeof out.email === 'string') out.email = out.email.toLowerCase();

    if (typeof out.employeeCode === 'string') {
      const other = await this.persons.findByEmployeeCode(out.employeeCode);
      if (other && other.id !== current?.id) throw new ConflictException(`Mã cán bộ đã có: ${out.employeeCode}`);
    }
    if (typeof out.nationalId === 'string') {
      const other = await this.persons.findByNationalId(out.nationalId);
      if (other && other.id !== current?.id) throw new ConflictException('Số định danh cá nhân (CCCD) đã có ở cán bộ khác');
    }
    const today = this.clock.now().toISOString().slice(0, 10);
    const merged = { ...(current ?? EMPTY_PROFILE), ...out } as Record<string, string | null>;
    for (const f of ['dateOfBirth', 'joinedAgencyOn', 'partyJoinedOn'] as const) {
      const v = merged[f];
      if (typeof v === 'string' && v > today) throw new BadRequestException('Ngày không được ở tương lai');
    }
    const born = merged.dateOfBirth;
    for (const f of ['joinedAgencyOn', 'partyJoinedOn'] as const) {
      const v = merged[f];
      if (born && v && v < born) throw new BadRequestException('Ngày vào cơ quan, vào Đảng không được trước ngày sinh');
    }
    return out;
  }

  /** Ngừng quản lý cán bộ. Phải kết thúc phân công đang có trước, để không để vị trí mồ côi. */
  async deactivate(id: string): Promise<void> {
    const person = await this.get(id);
    if (!person.active) return;
    const now = this.clock.now();
    if ((await this.assignments.findByPerson(id)).some((a) => isCurrent(a, now))) {
      throw new ConflictException('Cán bộ đang giữ vị trí, hãy kết thúc phân công trước');
    }
    await this.persons.setActive(id, false);
    await this.audit.record({
      action: 'person.deactivate',
      outcome: 'SUCCESS',
      targetType: 'person',
      targetId: id,
      details: { fullName: person.fullName },
    });
  }

  history(personId: string): Promise<AssignmentModel[]> {
    return this.get(personId).then(() => this.assignments.findByPerson(personId));
  }

  /** Gắn tài khoản với cán bộ đang hoạt động (quyền `account:link-person`). */
  async linkAccount(personId: string, accountId: string): Promise<void> {
    const person = await this.get(personId);
    if (!person.active) throw new ConflictException('Cán bộ đã ngừng quản lý');
    await this.accounts.linkPerson(accountId, personId);
  }

  async unlinkAccount(personId: string): Promise<void> {
    await this.get(personId);
    const account = await this.accounts.findByPersonId(personId);
    if (account) await this.accounts.unlinkPerson(account.id);
  }
}

/** Cắt khoảng trắng thừa ở đầu, cuối và giữa họ tên. */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}
