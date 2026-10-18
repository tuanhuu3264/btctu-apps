import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthorizationService, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import type { EvaluationModel, PeriodModel, TaskModel } from '../application/evaluation.model.js';
import type { LeaveMonth } from '../application/leave.js';
import { EvaluationService } from '../application/evaluation.service.js';
import { UnitEvaluationService } from '../application/unit-evaluation.service.js';
import { RatingEventService } from '../application/rating-event.service.js';
import type { RatingEventModel } from '../application/rating-events.js';
import type { EvaluationView, GenerateResult, InsightView, PeriodView } from '../application/evaluation.service.js';
import type { Simulation } from '../application/score-insight.js';
import {
  AddTaskDto,
  ApproveEvaluationDto,
  CreateEvaluationDto,
  CreatePeriodDto,
  CreateRatingEventDto,
  RecordResultDto,
  NotRatedDto,
  SetDeadlineDto,
  SetLeaveDto,
  ReturnDto,
  ReviewDto,
  SelfSubmitDto,
  SimulateDto,
} from './evaluation.dto.js';

@Controller('evaluation')
export class EvaluationController {
  constructor(
    private readonly evaluation: EvaluationService,
    private readonly unitEvaluation: UnitEvaluationService,
    private readonly ratingEvents: RatingEventService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Có quyền xem toàn bộ hồ sơ không (Văn phòng, Trưởng ban), ngoài phạm vi theo cây vị trí. */
  private async canReadAll(actor: CurrentAccountModel): Promise<boolean> {
    return (await this.authorization.permissionsOf(actor.id)).has('evaluation:read-all');
  }

  // ---- kỳ đánh giá

  @Get('periods')
  @RequirePermission('evaluation:read')
  listPeriods(): Promise<PeriodView[]> {
    return this.evaluation.listPeriods();
  }

  /** Gia hạn hoặc đặt lại hạn hoàn thành đánh giá năm (15/12 đến 15/01 năm sau). */
  @Put('periods/:id/deadline')
  @RequirePermission('evaluation:period-manage')
  setDeadline(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDeadlineDto): Promise<PeriodView> {
    return this.evaluation.setDeadline(actor, id, dto.deadline, dto.reason);
  }

  /** Nhắc người đang giữ hồ sơ cá nhân và tập thể của kỳ năm chưa xong. */
  @Post('periods/:id/remind')
  @HttpCode(200)
  @RequirePermission('evaluation:period-manage')
  async remind(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<{ persons: number; units: number }> {
    const [persons, units] = await Promise.all([this.evaluation.remindDeadline(actor, id), this.unitEvaluation.remindDeadline(actor, id)]);
    return { persons: persons.notified, units: units.notified };
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
    return this.evaluation.createEvaluation(actor, periodId, dto.personId, dto.positionId);
  }

  @Get('periods/:id/evaluations')
  @RequirePermission('evaluation:read')
  async list(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) periodId: string): Promise<EvaluationModel[]> {
    return this.evaluation.listEvaluations(actor, periodId, await this.canReadAll(actor));
  }

  /** Các tháng nghỉ có căn cứ của cán bộ trong năm (ADR-039). */
  @Get('persons/:personId/leave')
  @RequirePermission('evaluation:read')
  async leave(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Query('year', ParseIntPipe) year: number,
  ): Promise<LeaveMonth[]> {
    return this.evaluation.leaveOf(actor, personId, year, await this.canReadAll(actor));
  }

  /** Văn phòng ghi nhận tháng nghỉ ốm, thai sản, nghỉ việc riêng không lương (Điều 11.2). */
  @Put('persons/:personId/leave')
  @RequirePermission('evaluation:period-manage')
  setLeave(@CurrentAccount() actor: CurrentAccountModel, @Param('personId', ParseUUIDPipe) personId: string, @Body() dto: SetLeaveDto): Promise<LeaveMonth[]> {
    return this.evaluation.setLeave(actor, personId, dto.year, dto.months);
  }

  /** Kỷ luật, kết luận, kết quả lấy phiếu của cán bộ trong năm (ADR-055); chỉ chính cán bộ, cấp trên và người xem toàn bộ. */
  @Get('persons/:personId/rating-events')
  @RequirePermission('evaluation:read')
  async listRatingEvents(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Query('year', ParseIntPipe) year: number,
  ): Promise<RatingEventModel[]> {
    return this.ratingEvents.list(actor, personId, year, await this.canReadAll(actor));
  }

  /** Văn phòng ghi nhận kỷ luật, kết luận, kết quả lấy phiếu. */
  @Post('persons/:personId/rating-events')
  @RequirePermission('evaluation:period-manage')
  createRatingEvent(@CurrentAccount() actor: CurrentAccountModel, @Param('personId', ParseUUIDPipe) personId: string, @Body() dto: CreateRatingEventDto): Promise<RatingEventModel> {
    return this.ratingEvents.create(actor, personId, dto);
  }

  @Delete('rating-events/:id')
  @HttpCode(204)
  @RequirePermission('evaluation:period-manage')
  removeRatingEvent(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.ratingEvents.remove(actor, id);
  }

  @Get('evaluations/:id')
  @RequirePermission('evaluation:read')
  async get(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<EvaluationView> {
    return this.evaluation.getEvaluation(actor, id, await this.canReadAll(actor));
  }

  /** Giải thích điểm của hồ sơ: điểm từng thành phần, điểm mất ở từng dòng việc, gợi ý để lên mức kế tiếp. */
  @Get('evaluations/:id/insight')
  @RequirePermission('evaluation:read')
  async insight(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<InsightView> {
    return this.evaluation.getInsight(actor, id, await this.canReadAll(actor));
  }

  /** Mô phỏng "nếu…": tính lại điểm với giả định, không ghi vào hồ sơ. */
  @Post('evaluations/:id/simulate')
  @HttpCode(200)
  @RequirePermission('evaluation:read')
  async simulate(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateDto): Promise<Simulation> {
    return this.evaluation.simulate(actor, id, await this.canReadAll(actor), dto);
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

  /** Người thẩm định đóng hồ sơ năm là "không xếp loại" khi chưa đủ 6 tháng công tác (Điều 11.1). */
  @Post('evaluations/:id/not-rated')
  @HttpCode(200)
  @RequirePermission('evaluation:review')
  notRated(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NotRatedDto): Promise<EvaluationView> {
    return this.evaluation.closeNotRated(actor, id, dto.comment);
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
    return this.evaluation.approve(actor, id, dto.comment, dto.exception);
  }
}
