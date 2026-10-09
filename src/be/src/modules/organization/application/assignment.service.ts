import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from '../../security/index.js';
import { overlaps } from './org.model.js';
import type { AssignmentModel } from './org.model.js';
import { AssignmentRepository } from './org.ports.js';
import { PersonService } from './person.service.js';
import { PositionService } from './position.service.js';

/**
 * Phân công cán bộ vào vị trí việc làm theo thời gian (ADR-012 mục 1, 4). Một người một vị trí,
 * một vị trí một người tại mọi thời điểm. Chuyển công tác = kết thúc phân công cũ rồi tạo phân công mới.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly persons: PersonService,
    private readonly positions: PositionService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async assign(positionId: string, personId: string, validFrom?: Date): Promise<AssignmentModel> {
    const person = await this.persons.get(personId);
    if (!person.active) throw new ConflictException('Cán bộ đã ngừng quản lý');
    const position = await this.positions.get(positionId);

    const candidate = { validFrom: validFrom ?? this.clock.now(), validTo: null };
    const personClash = (await this.assignments.findByPerson(personId)).find((a) => overlaps(a, candidate));
    if (personClash) throw new ConflictException('Cán bộ đã giữ một vị trí khác trong khoảng thời gian này');
    const positionClash = (await this.assignments.findByPosition(positionId)).find((a) => overlaps(a, candidate));
    if (positionClash) throw new ConflictException('Vị trí đã có người giữ trong khoảng thời gian này');

    const created = await this.assignments.create({ personId, positionId, ...candidate });
    await this.audit.record({
      action: 'assignment.create',
      outcome: 'SUCCESS',
      targetType: 'assignment',
      targetId: created.id,
      details: { personId, fullName: person.fullName, positionId, positionCode: position.code, validFrom: created.validFrom },
    });
    return created;
  }

  async end(assignmentId: string, at?: Date): Promise<void> {
    const assignment = await this.assignments.findById(assignmentId);
    if (!assignment) throw new NotFoundException(`Không tìm thấy phân công: ${assignmentId}`);
    if (assignment.validTo) throw new ConflictException('Phân công đã kết thúc');

    const endAt = at ?? this.clock.now();
    if (endAt <= assignment.validFrom) throw new BadRequestException('Thời điểm kết thúc phải sau thời điểm bắt đầu');
    await this.assignments.end(assignmentId, endAt);
    await this.audit.record({
      action: 'assignment.end',
      outcome: 'SUCCESS',
      targetType: 'assignment',
      targetId: assignmentId,
      details: { personId: assignment.personId, positionId: assignment.positionId, validTo: endAt },
    });
  }

  list(): Promise<AssignmentModel[]> {
    return this.assignments.findAll();
  }
}
