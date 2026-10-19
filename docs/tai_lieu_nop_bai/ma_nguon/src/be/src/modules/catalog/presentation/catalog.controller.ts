import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import { CatalogService } from '../application/catalog.service.js';
import type { CatalogGroupModel, CatalogItemModel, CatalogTaskModel, CatalogVersionModel, CatalogVersionView } from '../application/catalog.model.js';
import { AddItemDto, ApproveVersionDto, CreateCatalogTaskDto, CreateGroupDto, CreateVersionDto, DeactivateCatalogDto, ScopeDto, SetBaselineDto, UpdateCatalogTaskDto, UpdateGroupDto, UpdateItemDto, UpdateVersionDto } from './catalog.dto.js';

/** Bỏ các khóa undefined (DTO khai báo thuộc tính nên khóa luôn tồn tại) để cập nhật một phần không ghi đè. */
function definedOnly<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('versions')
  @RequirePermission('catalog:read')
  listVersions(): Promise<CatalogVersionModel[]> {
    return this.catalog.listVersions();
  }

  @Post('versions')
  @RequirePermission('catalog:manage')
  createVersion(@Body() dto: CreateVersionDto): Promise<CatalogVersionModel> {
    return this.catalog.createVersion(dto);
  }

  /** Thêm nhóm công việc dùng chung cho mọi phiên bản (ADR-020). */
  @Post('groups')
  @RequirePermission('catalog:manage')
  createGroup(@Body() dto: CreateGroupDto): Promise<CatalogGroupModel> {
    return this.catalog.createGroup(dto);
  }

  @Patch('groups/:code')
  @RequirePermission('catalog:manage')
  renameGroup(@Param('code') code: string, @Body() dto: UpdateGroupDto): Promise<CatalogGroupModel> {
    return this.catalog.renameGroup(code.toUpperCase(), dto.name);
  }

  @Delete('groups/:code')
  @HttpCode(204)
  @RequirePermission('catalog:manage')
  deleteGroup(@Param('code') code: string): Promise<void> {
    return this.catalog.deleteGroup(code.toUpperCase());
  }

  /** Đổi tên danh mục của bản nháp (nhãn phiên bản không đổi). */
  @Patch('versions/:id')
  @RequirePermission('catalog:manage')
  renameVersion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVersionDto): Promise<CatalogVersionModel> {
    return this.catalog.renameVersion(id, dto.name);
  }

  /** Phiên bản đã phê duyệt đang có hiệu lực, kèm công việc và hệ số quy đổi. */
  @Get('current')
  @RequirePermission('catalog:read')
  current(): Promise<CatalogVersionView> {
    return this.catalog.current();
  }

  @Get('versions/:id')
  @RequirePermission('catalog:read')
  getVersion(@Param('id', ParseUUIDPipe) id: string): Promise<CatalogVersionView> {
    return this.catalog.getVersion(id);
  }

  /** Thêm nhiệm vụ vào một nhóm của bản nháp (ADR-019). */
  @Post('versions/:id/tasks')
  @RequirePermission('catalog:manage')
  addTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCatalogTaskDto): Promise<CatalogTaskModel> {
    return this.catalog.createTask(id, dto);
  }

  @Patch('tasks/:id')
  @RequirePermission('catalog:manage')
  updateTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCatalogTaskDto): Promise<CatalogTaskModel> {
    return this.catalog.updateTask(id, definedOnly(dto));
  }

  /** "Xóa" nhiệm vụ của bản nháp: đổi sang INACTIVE, không xóa dòng (PLAN-A A1.6). */
  @Delete('tasks/:id')
  @RequirePermission('catalog:manage')
  deleteTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateCatalogDto): Promise<CatalogTaskModel> {
    return this.catalog.deactivateTask(id, dto?.reason);
  }

  @Post('tasks/:id/reactivate')
  @HttpCode(200)
  @RequirePermission('catalog:manage')
  reactivateTask(@Param('id', ParseUUIDPipe) id: string): Promise<CatalogTaskModel> {
    return this.catalog.reactivateTask(id);
  }

  @Post('versions/:id/items')
  @RequirePermission('catalog:manage')
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddItemDto): Promise<CatalogItemModel> {
    return this.catalog.addItem(id, dto);
  }

  @Put('versions/:id/baseline')
  @RequirePermission('catalog:manage')
  setBaseline(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetBaselineDto): Promise<CatalogVersionView> {
    return this.catalog.setBaseline(id, dto.itemCode);
  }

  @Post('versions/:id/approve')
  @RequirePermission('catalog:approve')
  approve(
    @CurrentAccount() approver: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveVersionDto,
  ): Promise<CatalogVersionView> {
    return this.catalog.approve(approver, id, dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined);
  }

  /** Gán phạm vi áp dụng (đơn vị, vị trí) cho một công việc; rỗng cả hai là việc chung (ADR-021). */
  @Put('items/:id/scope')
  @RequirePermission('catalog:manage')
  setItemScope(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScopeDto) {
    return this.catalog.setItemScope(id, dto);
  }

  /** Gán cùng một phạm vi cho mọi công việc của một nhiệm vụ. */
  @Put('tasks/:id/scope')
  @RequirePermission('catalog:manage')
  setTaskScope(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScopeDto) {
    return this.catalog.setTaskScope(id, dto);
  }

  @Patch('items/:id')
  @RequirePermission('catalog:manage')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto): Promise<CatalogItemModel> {
    return this.catalog.updateItem(id, definedOnly(dto));
  }

  /** "Xóa" công việc của bản nháp: đổi sang INACTIVE, không xóa dòng (PLAN-A A1.6). */
  @Delete('items/:id')
  @RequirePermission('catalog:manage')
  deleteItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateCatalogDto): Promise<CatalogItemModel> {
    return this.catalog.deactivateItem(id, dto?.reason);
  }

  @Post('items/:id/reactivate')
  @HttpCode(200)
  @RequirePermission('catalog:manage')
  reactivateItem(@Param('id', ParseUUIDPipe) id: string): Promise<CatalogItemModel> {
    return this.catalog.reactivateItem(id);
  }
}
