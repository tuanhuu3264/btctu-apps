import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AccountService } from '../application/account.service.js';
import type { AccountSummary, RoleAssignmentModel } from '../application/authorization.model.js';
import { MfaService } from '../application/mfa.service.js';
import { RoleService } from '../application/role.service.js';
import type { CurrentAccount as CurrentAccountModel } from '../application/security.model.js';
import { CreateAccountDto, GrantRoleDto } from './account.dto.js';
import { CurrentAccount } from './current-account.decorator.js';
import { RequirePermission } from './require-permission.decorator.js';

@Controller('accounts')
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly roles: RoleService,
    private readonly mfa: MfaService,
  ) {}

  @Get()
  @RequirePermission('account:read')
  list(): Promise<AccountSummary[]> {
    return this.accounts.list();
  }

  @Post()
  @RequirePermission('account:create')
  create(@Body() dto: CreateAccountDto): Promise<CurrentAccountModel> {
    return this.accounts.create(dto);
  }

  @Post(':id/disable')
  @HttpCode(204)
  @RequirePermission('account:disable')
  disable(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.accounts.disable(actor, id);
  }

  /** Mất thiết bị xác thực: xóa thiết bị, thu hồi phiên; lần đăng nhập sau đăng ký lại (ADR-048). */
  @Post(':id/mfa/reset')
  @HttpCode(204)
  @RequirePermission('account:mfa-reset')
  resetMfa(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.mfa.reset(actor, id);
  }

  @Get(':id/roles')
  @RequirePermission('role:read')
  listRoles(@Param('id', ParseUUIDPipe) id: string): Promise<RoleAssignmentModel[]> {
    return this.roles.list(id);
  }

  @Post(':id/roles')
  @RequirePermission('role:assign')
  grantRole(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantRoleDto,
  ): Promise<RoleAssignmentModel> {
    return this.roles.grant(actor, {
      accountId: id,
      role: dto.role,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
      validTo: dto.validTo ? new Date(dto.validTo) : undefined,
    });
  }

  @Delete(':id/roles/:assignmentId')
  @HttpCode(204)
  @RequirePermission('role:assign')
  revokeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ): Promise<void> {
    return this.roles.revoke(id, assignmentId);
  }
}
