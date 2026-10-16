import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Authenticated, AuthorizationService, CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import type { AccessReviewDetail, AccessReviewItemModel, AccessReviewView } from '../application/access-review.model.js';
import { AccessReviewService } from '../application/access-review.service.js';
import type { ReviewAccess } from '../application/access-review.service.js';
import { CreateAccessReviewDto, DecideItemDto } from './access-review.dto.js';

/**
 * Rà soát quyền định kỳ (ADR-044). Quản trị hệ thống (`access-review:manage`) tạo, đóng, nhắc; lãnh đạo
 * (`access-review:confirm`) và quản trị dữ liệu (`access-review:oversee`) xác nhận mục được giao.
 * Các route cho nhiều nhóm quyền dùng @Authenticated rồi kiểm ở đây (RequirePermission đòi đủ mọi quyền).
 */
@Controller('access-reviews')
export class AccessReviewController {
  constructor(
    private readonly reviews: AccessReviewService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async access(actor: CurrentAccountModel): Promise<ReviewAccess> {
    const p = await this.authorization.permissionsOf(actor.id);
    return { manage: p.has('access-review:manage'), oversee: p.has('access-review:oversee'), confirm: p.has('access-review:confirm') };
  }

  private async requireAny(actor: CurrentAccountModel): Promise<ReviewAccess> {
    const access = await this.access(actor);
    if (!access.manage && !access.oversee && !access.confirm) throw new ForbiddenException('Không đủ quyền thực hiện thao tác này');
    return access;
  }

  /** Quý hiện tại đã có đợt rà soát chưa (nhắc quản trị tạo đợt đầu quý). */
  @Get('suggestion')
  @RequirePermission('access-review:manage')
  suggestion() {
    return this.reviews.suggestion();
  }

  @Get()
  @Authenticated()
  async list(@CurrentAccount() actor: CurrentAccountModel): Promise<AccessReviewView[]> {
    return this.reviews.list(actor, await this.requireAny(actor));
  }

  @Post()
  @RequirePermission('access-review:manage')
  create(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: CreateAccessReviewDto): Promise<AccessReviewView> {
    return this.reviews.create(actor, dto);
  }

  @Get(':id')
  @Authenticated()
  async get(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<AccessReviewDetail> {
    return this.reviews.get(actor, id, await this.requireAny(actor));
  }

  @Post('items/:itemId/decision')
  @HttpCode(200)
  @Authenticated()
  async decide(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: DecideItemDto,
  ): Promise<AccessReviewItemModel> {
    return this.reviews.decide(actor, itemId, dto, await this.requireAny(actor));
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('access-review:manage')
  close(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<AccessReviewView> {
    return this.reviews.close(actor, id);
  }

  @Post(':id/remind')
  @HttpCode(200)
  @RequirePermission('access-review:manage')
  remind(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.remind(actor, id);
  }

  @Get(':id/export')
  @Authenticated()
  async export(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const access = await this.requireAny(actor);
    if (!access.manage && !access.oversee) throw new ForbiddenException('Không đủ quyền thực hiện thao tác này');
    const file = await this.reviews.export(actor, id);
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(file.buffer);
  }
}
