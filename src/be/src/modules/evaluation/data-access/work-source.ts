import { Injectable } from '@nestjs/common';
import { TaskingService } from '../../tasking/index.js';
import { PeriodWorkSource } from '../application/evaluation.ports.js';
import type { PeriodWork } from '../application/evaluation.ports.js';

/** Adapter sang mô-đun tasking: dùng giao diện công khai của mô-đun đó, không đụng bảng của nó. */
@Injectable()
export class TaskingWorkSourceAdapter extends PeriodWorkSource {
  constructor(private readonly tasking: TaskingService) {
    super();
  }

  async collect(period: { type: 'MONTH' | 'QUARTER' | 'YEAR'; startDate: string; endDate: string }): Promise<PeriodWork[]> {
    return (await this.tasking.collectForPeriod(period)).map((w) => ({
      assignmentId: w.assignmentId,
      taskTitle: w.taskTitle,
      personId: w.personId,
      catalogItemCode: w.catalogItemCode,
      plannedQuantity: w.plannedQuantity,
      confirmedQuantity: w.confirmedQuantity,
      lateCount: w.lateCount,
      reworkCount: w.reworkCount,
      evidence: w.evidence,
    }));
  }
}
