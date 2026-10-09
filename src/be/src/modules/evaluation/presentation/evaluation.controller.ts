import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthorizationService, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import type { EvaluationModel, PeriodModel, TaskModel } from '../application/evaluation.model.js';
import { EvaluationService } from '../application/evaluation.service.js';
import type { EvaluationView, GenerateResult } from '../application/evaluation.service.js';
import {
  AddTaskDto,
  ApproveEvaluationDto,
  CreateEvaluationDto,
  CreatePeriodDto,
  RecordResultDto,
  ReturnDto,
  ReviewDto,
  SelfSubmitDto,
} from './evaluation.dto.js';

@Controller('evaluation')
export class EvaluationController {
  constructor(
    private readonly evaluation: EvaluationService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Có quyền xem toàn bộ hồ sơ không (Văn phòng, Trưởng ban), ngoài phạm vi theo cây vị trí. */
  private async canReadAll(actor: CurrentAccountModel): Promise<boolean> {
    return (await this.authorization.permissionsOf(actor.id)).has('evaluation:read-all');
  }

  // ---- kỳ đánh giá

  @Get('periods')
  @RequirePermission('evaluation:read')
  listPeriods(): Promise<PeriodModel[]> {
    return this.evaluation.listPeriods();
  }

  @Post('periods')
  @RequirePermission('evaluation:period-manage')
  createPeriod(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: CreatePeriodDto): Promise<PeriodModel> {
    return this.evaluation.createPeriod(actor, dto);
  }

  @Post('periods/:id/close')
  @HttpCode(204)
  @RequirePermission('evaluation:period-manage')
  closePeriod(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.evaluation.closePeriod(id);
  }

  /** Văn phòng tạo hồ sơ từ các việc được giao thuộc kỳ, điền sẵn chỉ tiêu và kết quả đã xác nhận (ADR-016). */
  @Post('periods/:id/generate')
  @HttpCode(200)
  @RequirePermission('evaluation:period-manage')
  generate(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string): Promise<GenerateResult> {
    return this.evaluation.generateFromWork(actor, periodId);
  }

  // ---- hồ sơ

  /** Bước 1: giao mục tiêu, tạo hồ sơ cho cấp dưới trực tiếp. */
  @Post('periods/:id/evaluations')
  @RequirePermission('evaluation:assign')
  create(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) periodId: string,
    @Body() dto: CreateEvaluationDto,
  ): Promise<EvaluationModel> {
    return this.evaluation.createEvaluation(actor, periodId, dto.personId);
  }

  @Get('periods/:id/evaluations')
  @RequirePermission('evaluation:read')
  async list(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string): Promise<EvaluationModel[]> {
    return this.evaluation.listEvaluations(actor, periodId, await this.canReadAll(actor));
  }

  @Get('evaluations/:id')
  @RequirePermission('evaluation:read')
  async get(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<EvaluationView> {
    return this.evaluation.getEvaluation(actor, id, await this.canReadAll(actor));
  }

  // ---- chỉ tiêu

  @Post('evaluations/:id/tasks')
  @RequirePermission('evaluation:assign')
  addTask(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTaskDto): Promise<TaskModel> {
    return this.evaluation.addTask(actor, id, dto);
  }

  @Delete('tasks/:taskId')
  @HttpCode(204)
  @RequirePermission('evaluation:assign')
  removeTask(@CurrentAccount() actor: CurrentAccountModel, @Param('taskId', ParseUUIDPipe) taskId: string): Promise<void> {
    return this.evaluation.removeTask(actor, taskId);
  }

  /** Bước 2: cá nhân ghi số lượng hoàn thành và minh chứng. */
  @Patch('tasks/:taskId/result')
  @RequirePermission('evaluation:self')
  recordResult(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: RecordResultDto,
  ): Promise<TaskModel> {
    return this.evaluation.recordResult(actor, taskId, dto);
  }

  // ---- luồng

  @Post('evaluations/:id/self-submit')
  @RequirePermission('evaluation:self')
  selfSubmit(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SelfSubmitDto): Promise<EvaluationModel> {
    return this.evaluation.selfSubmit(actor, id, dto);
  }

  /** Bước 3: thẩm định, nhận xét, đề xuất xếp loại. */
  @Post('evaluations/:id/review')
  @RequirePermission('evaluation:review')
  review(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto): Promise<EvaluationView> {
    return this.evaluation.review(actor, id, dto);
  }

  @Post('evaluations/:id/return')
  @RequirePermission('evaluation:review')
  returnEvaluation(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnDto): Promise<EvaluationModel> {
    return this.evaluation.returnEvaluation(actor, id, dto.reason);
  }

  /** Bước 4: quyết định, phê duyệt. Từ đây hồ sơ khóa. */
  @Post('evaluations/:id/approve')
  @RequirePermission('evaluation:approve')
  approve(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveEvaluationDto): Promise<EvaluationView> {
    return this.evaluation.approve(actor, id, dto.comment);
  }
}
